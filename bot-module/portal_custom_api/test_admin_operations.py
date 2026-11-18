"""Native money handlers are mocked; no production storage/services imported."""
import importlib.util
import pathlib
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import Column, Float, Integer, JSON, String
from sqlalchemy.orm import declarative_base


def stub(name, **values):
    parts=name.split('.')
    for i in range(1,len(parts)+1):
        key='.'.join(parts[:i])
        if key not in sys.modules:
            sys.modules[key]=types.ModuleType(key); sys.modules[key].__path__=[]
        if i>1: setattr(sys.modules['.'.join(parts[:i-1])],parts[i-1],sys.modules[key])
    for key,value in values.items(): setattr(sys.modules[name],key,value)

Base=declarative_base()
class User(Base):
    __tablename__='users'; id=Column(Integer,primary_key=True); balance=Column(Float)
class AuditEvent(Base):
    __tablename__='events'; id=Column(Integer,primary_key=True)
    event_type=Column(String); request_id=Column(String); actor_identity_id=Column(String)
    actor_tg_id=Column(Integer); entity_type=Column(String); entity_id=Column(String)
    channel=Column(String); path_or_handler=Column(String); result=Column(String); metadata_=Column(JSON)
class Key(Base):
    __tablename__='keys'; user_id=Column(Integer,primary_key=True); client_id=Column(String,primary_key=True)
    tariff_id=Column(Integer); expiry_time=Column(Integer); current_device_limit=Column(Integer); selected_traffic_limit=Column(Integer)

native=AsyncMock(return_value={'ok':True,'balance':75})
stub('api.depends',get_session=lambda:None,verify_identity_admin=lambda:None)
stub('api.admin_permissions',require_admin_action=AsyncMock())
stub('database.models',User=User,AuditEvent=AuditEvent,Key=Key)
stub('filters.permissions',PERM_USER_BALANCE='balance',PERM_KEY_TARIFF='tariff')
stub('api.v2.routes.keys.admin_subs',_resolve=AsyncMock(),sub_change_tariff=AsyncMock())
stub('database.tariffs',get_tariff_by_id=AsyncMock())
stub('api.v2.routes.users',adjust_user_balance=native)
stub('api.v2.schemas.user_management',UserBalanceRequest=lambda **kwargs:SimpleNamespace(**kwargs))
spec=importlib.util.spec_from_file_location('admin_operations',pathlib.Path(__file__).with_name('admin_operations.py'))
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)


class OperationsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        native.reset_mock()
        self.session=SimpleNamespace(scalar=AsyncMock(side_effect=[SimpleNamespace(id=12,balance=50),None]),add=Mock(),flush=AsyncMock())
        self.identity=SimpleNamespace(id='admin',tg_id=123)
        self.endpoint=module.get_router().routes[0].endpoint

    async def call(self, body):
        return await self.endpoint(kind='balance',target='12',body=body,identity=self.identity,session=self.session)

    async def test_preview_never_calls_money_handler(self):
        result=await self.call(module.Operation(amount=25))
        self.assertEqual(result['before'],{'balance':'50.00'})
        self.assertEqual(result['after'],{'balance':'75.00'})
        native.assert_not_awaited(); self.session.add.assert_not_called()

    async def test_stale_preview_and_missing_reason_cannot_mutate(self):
        for reason,expected in [('because',{'balance':'49.00'}),('',{'balance':'50.00'})]:
            self.session.scalar.side_effect=[SimpleNamespace(id=12,balance=50),None]
            with self.assertRaises(HTTPException):
                await self.call(module.Operation(preview=False,amount=25,reason=reason,expected=expected,request_id=uuid4()))
        native.assert_not_awaited()

    async def test_confirm_delegates_once_and_stores_reason(self):
        result=await self.call(module.Operation(preview=False,amount=25,reason='Correction',expected={'balance':'50.00'},request_id=uuid4()))
        self.assertEqual(result['balance'],75); native.assert_awaited_once()
        record=self.session.add.call_args.args[0]
        self.assertEqual(record.metadata_['reason'],'Correction')
        self.assertEqual(record.metadata_['after'],{'balance':'75.00'})

    async def test_replay_returns_receipt_without_second_debit(self):
        body=module.Operation(preview=False,amount=-25,reason='Correction',expected={'balance':'50.00'},request_id=uuid4())
        fingerprint={'kind':'balance','target':'12','amount':'-25','tariff_id':None,'reason':'Correction'}
        self.session.scalar.side_effect=[SimpleNamespace(id=12,balance=0),SimpleNamespace(metadata_={'fingerprint':fingerprint,'response':{'ok':True,'balance':25}})]
        result=await self.call(body)
        self.assertEqual(result['balance'],25); native.assert_not_awaited()

    async def test_insufficient_balance_and_nonfinite_amount_rejected(self):
        with self.assertRaises(HTTPException): await self.call(module.Operation(amount=-100))
        for value in ['NaN','Infinity','0.001']:
            with self.assertRaises(ValidationError): module.Operation(amount=value)
        native.assert_not_awaited()

    async def test_tariff_preview_keeps_expiry_and_uses_native_limits(self):
        key=SimpleNamespace(user_id=12,client_id='key',tariff_id=1,expiry_time=1000,current_device_limit=3,selected_traffic_limit=None)
        sys.modules['api.v2.routes.keys.admin_subs']._resolve.return_value=key
        tariffs=sys.modules['database.tariffs'].get_tariff_by_id
        tariffs.side_effect=[{'name':'Old','traffic_limit':20},{'name':'New','device_limit':10,'traffic_limit':0}]
        self.session.scalar.side_effect=[key]
        result=await self.endpoint(kind='tariff',target='key',body=module.Operation(tariff_id=2),identity=self.identity,session=self.session)
        self.assertEqual(result['after']['expiry_time'],1000)
        self.assertEqual(result['after']['devices'],10)
        self.assertEqual(result['after']['traffic_gb'],0)
        sys.modules['api.v2.routes.keys.admin_subs'].sub_change_tariff.assert_not_awaited()


if __name__=='__main__': unittest.main()
