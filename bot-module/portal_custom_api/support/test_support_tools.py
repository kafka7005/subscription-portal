"""Disposable SQLite/query tests and mocked message/notification delivery."""
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from contextlib import asynccontextmanager
from datetime import UTC,datetime,timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock,patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Boolean,Column,DateTime,Integer,String,Text,create_engine
from sqlalchemy.orm import declarative_base,Session
from sqlalchemy.dialects.postgresql import JSONB

def stub(name,**values):
    parts=name.split('.')
    for i in range(1,len(parts)+1):
        key='.'.join(parts[:i])
        if key not in sys.modules:
            sys.modules[key]=types.ModuleType(key);sys.modules[key].__path__=[]
        if i>1:setattr(sys.modules['.'.join(parts[:i-1])],parts[i-1],sys.modules[key])
    for key,value in values.items():setattr(sys.modules[name],key,value)
stub('api.depends',get_session=lambda:None,verify_identity_admin=lambda:None,verify_identity_agent=lambda:None)
def load(name):
    spec=importlib.util.spec_from_file_location(name,pathlib.Path(__file__).with_name(name+'.py'))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
tools=load('support_tools');reminders=load('support_reminders')
Base=declarative_base()
class Ticket(Base):
    __tablename__='tickets';id=Column(String,primary_key=True);status=Column(String)
class Message(Base):
    __tablename__='messages';id=Column(String,primary_key=True);ticket_id=Column(String);author=Column(String);body=Column(Text);created_at=Column(DateTime(timezone=True));deleted_at=Column(DateTime(timezone=True))
class User(Base):
    __tablename__='users';id=Column(Integer,primary_key=True);identity_id=Column(String)
class Identity(Base):
    __tablename__='identities';id=Column(String,primary_key=True);tg_id=Column(Integer);is_admin=Column(Boolean)
class Admin(Base):
    __tablename__='admins';tg_id=Column(Integer,primary_key=True);role=Column(String)


class PolicyTests(unittest.TestCase):
    def test_presence_excludes_self_stale_and_combines_staff_tabs(self):
        rows=[{'identity_id':'self','seen':99},{'identity_id':'a','seen':99,'typing_at':95,'name':'Agent'},
              {'identity_id':'a','seen':99,'typing_at':0},{'identity_id':'stale','seen':1,'typing_at':95}]
        result=tools.visible_staff(rows,'self',100)
        self.assertEqual(len(result),1);self.assertEqual(result[0]['id'],'a');self.assertTrue(result[0]['typing'])
        self.assertFalse(tools.visible_staff([{'identity_id':'a','seen':99,'typing_at':90}],'self',100)[0]['typing'])

    def test_search_escapes_literal_wildcards(self):
        self.assertEqual(tools.literal_search('50%_test\\'),'%50\\%\\_test\\\\%')

    def test_reminders_are_off_by_default_and_limits_are_validated(self):
        self.assertFalse(reminders.Config().enabled)
        for values in [{'wait_minutes':4},{'repeat_minutes':1},{'wait_minutes':10081}]:
            with self.assertRaises(ValidationError):reminders.Config(**values)

    def test_api_role_dependencies(self):
        for route in tools.get_router().routes:self.assertIn(sys.modules['api.depends'].verify_identity_agent,[d.call for d in route.dependant.dependencies])
        for route in reminders.get_router().routes:self.assertIn(sys.modules['api.depends'].verify_identity_admin,[d.call for d in route.dependant.dependencies])

    def test_waiting_query_ignores_answered_closed_recent_deleted_and_internal_notes(self):
        engine=create_engine('sqlite://');Base.metadata.create_all(engine)
        now=datetime.now(UTC)
        with Session(engine) as session:
            cases=[('waiting','open',[('client',120,False)]),('answered','answered',[('client',120,False)]),
                ('done','open',[('client',120,False),('agent',60,False)]),('note','open',[('client',120,False),('note',60,False)]),
                ('recent','open',[('client',2,False)]),('closed','closed',[('client',120,False)]),('deleted','open',[('client',120,True)])]
            for tid,status,messages in cases:
                session.add(Ticket(id=tid,status=status))
                for author,minutes,deleted in messages:session.add(Message(id=str(uuid4()),ticket_id=tid,author=author,created_at=now-timedelta(minutes=minutes),deleted_at=now if deleted else None))
            session.commit()
            result=session.execute(reminders.waiting_query(Ticket,Message,now-timedelta(minutes=30))).all()
            self.assertEqual({row[0].id for row in result},{'waiting','note'})
        engine.dispose()


class ReplyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.patcher=patch.dict(sys.modules);self.patcher.start()
        stub('database.models',Ticket=Ticket,TicketMessage=Message)
        self.native=AsyncMock(return_value={'id':'sent'})
        stub('api.v2.routes.tickets',agent_reply=self.native,MessageBody=lambda **kw:SimpleNamespace(**kw))
        self.endpoint=tools.get_router().routes[-1].endpoint
        self.ticket_id=uuid4();self.identity=SimpleNamespace(id='staff')

    async def asyncTearDown(self):self.patcher.stop()

    async def test_concurrent_reply_rejects_stale_client_without_sending(self):
        session=SimpleNamespace(scalar=AsyncMock(side_effect=[Ticket(id=str(self.ticket_id)),str(uuid4())]))
        with self.assertRaises(HTTPException) as error:await self.endpoint(tools.Reply(body='Reply'),self.ticket_id,self.identity,session)
        self.assertEqual(error.exception.status_code,409);self.native.assert_not_awaited()

    async def test_matching_version_delegates_to_native_delivery(self):
        previous=uuid4();session=SimpleNamespace(scalar=AsyncMock(side_effect=[Ticket(id=str(self.ticket_id)),str(previous)]))
        result=await self.endpoint(tools.Reply(body='Reply',expected_agent_message_id=previous),self.ticket_id,self.identity,session)
        self.assertEqual(result,{'id':'sent'});self.native.assert_awaited_once()

    async def test_internal_note_is_not_blocked_by_reply_version(self):
        session=SimpleNamespace(scalar=AsyncMock(return_value=Ticket(id=str(self.ticket_id))))
        await self.endpoint(tools.Reply(body='Note',internal=True),self.ticket_id,self.identity,session)
        self.assertEqual(session.scalar.await_count,1);self.native.assert_awaited_once()


class Redis:
    def __init__(self):self.items={}
    async def get(self,key):return self.items.get(key)
    async def set(self,key,value,nx=False,ex=None):
        if nx and key in self.items:return False
        self.items[key]=value;return True


class ReminderTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.patcher=patch.dict(sys.modules);self.patcher.start();self.redis=Redis()
        self.ticket=Ticket(id='ticket',status='open')
        self.last=Message(id='last-client',author='client',created_at=datetime.now(UTC)-timedelta(minutes=60))
        self.session=SimpleNamespace(execute=AsyncMock(return_value=SimpleNamespace(all=lambda:[(self.ticket,self.last.created_at)])),scalars=AsyncMock(return_value=SimpleNamespace(all=lambda:[1])),refresh=AsyncMock(),scalar=AsyncMock(return_value=self.last),commit=AsyncMock())
        tables = declarative_base()
        class Notification(tables):
            __tablename__='notifications'
            id=Column(String,primary_key=True)
            user_id=Column(Integer)
            created_at=Column(DateTime(timezone=True))
            data=Column(JSONB)
        self.saved=False
        stub('logger',logger=SimpleNamespace(info=lambda *a:None, warning=lambda *a:None))
        @asynccontextmanager
        async def maker():
            async def check(query, *args):
                return True if args else ('existing' if self.saved else None)
            async def commit():self.saved=True
            yield self.session if not getattr(self,'scanning',False) else SimpleNamespace(scalar=check,commit=commit)
        outer_execute=self.session.execute
        async def scan(*args):
            self.scanning=True
            return await outer_execute(*args)
        self.session.execute=AsyncMock(side_effect=scan)
        self.notification=Notification
        self.setting=AsyncMock(return_value={'enabled':True,'wait_minutes':30,'repeat_minutes':120})
        self.notify=AsyncMock()
        stub('core.settings.modes_config',MODES_CONFIG={'SUPPORT_TICKETS_ENABLED':True})
        stub('database',async_session_maker=maker)
        stub('database.settings',get_setting=self.setting)
        stub('database.models',Ticket=Ticket,TicketMessage=Message,Identity=Identity,User=User,Admin=Admin,WebNotification=self.notification)
        stub('database.web_notifications',notify_web=self.notify)
        stub('database.access.resolution',UserId=int)
        stub('core.redis_cache',_get_redis=AsyncMock(return_value=self.redis))

    async def asyncTearDown(self):self.patcher.stop()

    async def test_disabled_setting_sends_nothing(self):
        self.setting.return_value={}
        await reminders.scan_once();self.notify.assert_not_awaited();self.session.execute.assert_not_awaited()

    async def test_repeat_is_deduplicated_and_only_staff_receives_notification(self):
        await reminders.scan_once()
        self.notify.assert_awaited_once();self.assertEqual(self.notify.call_args.kwargs['user_ref'],1)
        self.assertEqual(self.notify.call_args.kwargs['data']['href'],'/admin/tickets/ticket')
        self.redis.items.pop('portal:support:reminders:scan')
        self.scanning=False
        await reminders.scan_once();self.notify.assert_awaited_once()

    async def test_uncreated_reminder_retries_next_scan(self):
        self.notify.return_value=None
        await reminders.scan_once()
        self.assertFalse(self.saved)
        self.redis.items.pop('portal:support:reminders:scan')
        self.scanning=False
        self.notify.return_value=object()
        await reminders.scan_once()
        self.assertTrue(self.saved)
        self.assertEqual(self.notify.await_count,2)

    async def test_answered_ticket_is_skipped_after_final_recheck(self):
        self.last.author='agent'
        await reminders.scan_once();self.notify.assert_not_awaited()

    async def test_recipient_query_excludes_clients_designers_and_duplicate_identities(self):
        await reminders.scan_once()
        statement=self.session.scalars.call_args.args[0]
        engine=create_engine('sqlite://');Base.metadata.create_all(engine)
        with Session(engine) as session:
            for iid,tg,admin,role in [('a',1,True,'admin'),('m',2,False,'moderator'),('d',3,True,'designer'),('c',4,False,None)]:
                session.add(Identity(id=iid,tg_id=tg,is_admin=admin))
                session.add(User(id=tg,identity_id=iid))
                if role:session.add(Admin(tg_id=tg,role=role))
            session.add(User(id=10,identity_id='a'));session.commit()
            self.assertEqual(set(session.scalars(statement).all()),{1,2})
        engine.dispose()


if __name__=='__main__':unittest.main()
