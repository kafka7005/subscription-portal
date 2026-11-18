"""Isolated module tests: no real users, database writes, push or payments."""
import asyncio
import importlib.util
import pathlib
import sys
import types
import unittest
from datetime import datetime
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from sqlalchemy import Column, Integer, MetaData, Table, select

deps = types.ModuleType('api.depends')
deps.get_session = lambda: None
deps.verify_identity_token = lambda: None
api = types.ModuleType('api'); api.__path__ = []
sys.modules['api'] = api; sys.modules['api.depends'] = deps

def load(name):
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).with_name(name+'.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

tools = load('customer_tools')
prefs = load('notification_preferences')


class CustomerTests(unittest.TestCase):
    def test_history_always_scopes_owner_and_recurring_subscription(self):
        table = Table('attempts', MetaData(), Column('user_id',Integer), Column('subscription_id',Integer))
        query = select(table).where(*tools.attempt_scope(table.c,123)).compile()
        self.assertIn('user_id =', str(query)); self.assertIn('subscription_id IS NOT NULL', str(query))
        self.assertEqual(list(query.params.values()),[123])

    def test_dates_have_explicit_timezone(self):
        self.assertEqual(tools.iso(datetime(2026,1,1)), '2026-01-01T00:00:00+00:00')
        self.assertIsNone(tools.iso(None))

    def test_category_mapping_does_not_capture_admin_or_system(self):
        self.assertEqual(prefs.preference_key('ticket'),'portal_push_support')
        self.assertEqual(prefs.preference_key('payment'),'portal_push_payments')
        for kind in ['key_created','key_expiry','key_expired','key_renewed']:
            self.assertEqual(prefs.preference_key(kind),'portal_push_subscriptions')
        for kind in ['system','admin','unknown']:
            self.assertIsNone(prefs.preference_key(kind))


class HookTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.created = AsyncMock(return_value=SimpleNamespace(id='notification'))
        self.sent = AsyncMock(return_value=(1,[]))
        self.sent._portal_preferences = False
        self.notifications = SimpleNamespace(create_notification=self.created)
        self.push = SimpleNamespace(send_push_to_many=self.sent)
        async def ticket_delivery(session, identity_id, title, body, url):
            return await self.push.send_push_to_many([{'endpoint':identity_id}], title, body, url, 'ticket-reply')
        self.delivery = SimpleNamespace(_webpush_client=ticket_delivery)
        self.modules = patch.dict(sys.modules, {
            'database':SimpleNamespace(web_notifications=self.notifications),
            'services':SimpleNamespace(web_push=self.push),
            'services.tickets':SimpleNamespace(delivery=self.delivery),
            'logger':SimpleNamespace(logger=SimpleNamespace(warning=lambda *a:None)),
        })
        self.modules.start(); prefs.install()

    async def asyncTearDown(self): self.modules.stop(); prefs._context.set(None)

    async def test_disabled_category_still_creates_bell_notification(self):
        with patch.object(prefs,'filter_subscriptions',AsyncMock(return_value=[])):
            await self.notifications.create_notification(None,identity_id='owner',type='payment',title='Paid',message='Body')
            result = await self.push.send_push_to_many([{'endpoint':'test'}],'Paid','Body')
        self.created.assert_awaited_once(); self.sent.assert_not_awaited()
        self.assertEqual(result,(0,[]))

    async def test_ticket_direct_import_path_uses_owner_preference(self):
        # Native tickets can create the bell using a pre-install imported alias.
        # No call to the wrapped create_notification is needed on this path.
        with patch.object(prefs,'filter_subscriptions',AsyncMock(return_value=[])) as filtering:
            result=await self.delivery._webpush_client(None,'owner','Support','Reply','/cabinet/support/1')
        self.assertEqual(result,(0,[])); self.sent.assert_not_awaited()
        context=filtering.call_args.args[0]
        self.assertEqual(context['identity_id'],'owner')
        self.assertEqual(context['type'],'ticket')
        self.assertIsNone(prefs._context.get())

    async def test_ticket_notifications_still_send_when_allowed(self):
        with patch.object(prefs,'filter_subscriptions',AsyncMock(side_effect=lambda context,subs:subs)):
            await self.delivery._webpush_client(None,'owner','Support','Reply','/cabinet/support/1')
        self.sent.assert_awaited_once()

    async def test_unrelated_delivery_and_install_are_unchanged(self):
        send = self.push.send_push_to_many; prefs.install(); self.assertIs(send,self.push.send_push_to_many)
        with patch.object(prefs,'filter_subscriptions',AsyncMock()) as filtering:
            await self.notifications.create_notification(None,identity_id='owner',type='ticket',title='Client',message='Body')
            await self.push.send_push_to_many([{'endpoint':'admin'}],'Admin','Other')
            filtering.assert_not_awaited()
        self.sent.assert_awaited_once()

    async def test_async_contexts_do_not_mix_owners(self):
        observed=[]
        async def filtering(context, subscriptions): observed.append(context['identity_id']); return subscriptions
        async def task(owner):
            await self.notifications.create_notification(None,identity_id=owner,type='ticket',title=owner,message='Body')
            await asyncio.sleep(0)
            await self.push.send_push_to_many([{'endpoint':owner}],owner,'Body')
        with patch.object(prefs,'filter_subscriptions',filtering): await asyncio.gather(task('a'),task('b'))
        self.assertCountEqual(observed,['a','b'])

    async def test_admin_alerts_bypass_customer_preferences(self):
        with patch.object(prefs,'filter_subscriptions',AsyncMock(return_value=[])) as filtering:
            await self.notifications.create_notification(None,identity_id='admin',type='ticket',title='Ticket',message='Body',data={'href':'/admin/tickets/1'})
            await self.push.send_push_to_many([{'endpoint':'admin'}],'Ticket','Body')
            filtering.assert_not_awaited()
        self.sent.assert_awaited_once()

    async def test_filter_removes_only_owned_endpoints(self):
        from sqlalchemy import String
        table=Table('prefs',MetaData(),Column('identity_id',String),Column('channel',String),Column('enabled',Integer),Column('endpoint',String))
        @asynccontextmanager
        async def savepoint(): yield
        session=SimpleNamespace(begin_nested=savepoint,scalar=AsyncMock(return_value=False),scalars=AsyncMock(return_value=SimpleNamespace(all=lambda:['owned'])))
        with patch.dict(sys.modules,{'database.models':SimpleNamespace(IdentityNotifPref=table.c,WebPushSubscription=table.c)}):
            result=await prefs.filter_subscriptions({'session':session,'identity_id':'owner','type':'ticket'},[{'endpoint':'owned'},{'endpoint':'other'}])
        self.assertEqual(result,[{'endpoint':'other'}])


if __name__ == '__main__': unittest.main()
