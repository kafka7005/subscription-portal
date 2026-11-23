"""Run in a bot environment. All database, panel and Telegram operations are mocked."""
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from . import management as m
from . import rotation


class SubscriptionTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.key = SimpleNamespace(user_id=10, client_id='fixture', server_id='cluster', email='fixture', key='old',
            remnawave_link='old', selected_device_limit=7, current_device_limit=12, selected_traffic_limit=50,
            current_traffic_limit=70, selected_price_rub=300, expiry_time=12345678, tariff_id=13)
        self.tariff = dict(id=13, configurable=True, price_rub=100, device_limit=1, device_step_rub=10,
            traffic_limit=20, traffic_step_rub=1, device_options=[1,7,9], traffic_options_gb=[0,20,50])
        self.session = AsyncMock()
        self.perms = self.mock(m,'require_admin_action')
        self.mock(m,'locked_key',self.key)
        self.mock(m,'_resolve',self.key)
        self.mock(m,'get_tariff_by_id',self.tariff)
        self.apply = self.mock(m,'_renew_apply')
        self.start(patch('database.keys.invalidate_key_details',new_callable=AsyncMock))
        self.routes = {r.path.rsplit('/',1)[-1]+next(iter(r.methods)): r.endpoint for r in m.get_router('/test').routes}

    def start(self, ctx):
        value=ctx.start()
        self.addCleanup(ctx.stop)
        return value

    def mock(self, obj, name, result=None):
        return self.start(patch.object(obj,name,AsyncMock(return_value=result)))

    def body(self, **changes):
        data=m.configuration(self.key,self.tariff)
        return m.Limits(**{k:changes.get(k,data[k]) for k in m.Limits.model_fields})

    async def save(self,body):
        return await self.routes['configurationPUT']('fixture',body,object(),self.session)

    async def test_base_addons_and_panel_totals(self):
        out=await self.save(self.body(base_devices=9,extra_devices=3,extra_traffic=25))
        self.assertEqual([out[k] for k in ('base_devices','extra_devices','base_traffic','extra_traffic')],[9,3,50,25])
        self.assertEqual((self.key.current_device_limit,self.key.current_traffic_limit,self.key.selected_price_rub),(12,75,210))
        self.assertEqual(self.apply.await_args.kwargs,dict(new_expiry=12345678,total_gb=75,hwid=12,reset_traffic=False))

    async def test_unlimited_and_other_dimension(self):
        await self.save(self.body(base_traffic=0,extra_traffic=0))
        self.assertEqual((self.key.selected_device_limit,self.key.current_device_limit),(7,12))
        self.assertEqual(self.apply.await_args.kwargs['total_gb'],0)
        self.assertNotIn(m.PERM_KEY_DEVICES,[a.args[2] for a in self.perms.await_args_list])

    async def test_reject_bad_option_stale_and_denied(self):
        for body in [self.body(base_devices=8),self.body(base_traffic=0),self.body(revision='0'*64)]:
            with self.assertRaises(HTTPException): await self.save(body)
        self.perms.side_effect=HTTPException(403)
        with self.assertRaises(HTTPException): await self.save(self.body(extra_devices=3))
        self.apply.assert_not_awaited()

    async def test_failure_before_database_mutation(self):
        self.apply.side_effect=HTTPException(502)
        with self.assertRaises(HTTPException): await self.save(self.body(base_devices=9))
        self.assertEqual(self.key.selected_device_limit,7)
        self.session.flush.assert_not_awaited()

    async def test_rotation_delivery_order(self):
        original=m.Revision(revision=m.link_revision(self.key))
        async def change(session,key):
            key.key=key.remnawave_link='replacement'
            return key.key
        self.start(patch.object(m,'rotate_link',AsyncMock(side_effect=change)))
        async def notify(session,owner,link):
            session.commit.assert_awaited_once()
            self.assertEqual((owner,link),(10,'replacement'))
            return False
        self.start(patch.object(m,'notify_owner',AsyncMock(side_effect=notify)))
        rotate=self.routes['rotate-linkPOST']
        self.assertEqual(await rotate('fixture',original,object(),self.session),{'notified':False})
        with self.assertRaises(HTTPException): await rotate('fixture',original,object(),self.session)

    async def test_remna_rotation(self):
        self.start(patch('database.servers.get_servers',AsyncMock(return_value={'cluster':[{'panel_type':'remnawave','api_url':'fixture'}]})))
        panel=AsyncMock()
        panel.revoke_user_subscription.return_value={'subscriptionUrl':'fixture-new'}
        self.start(patch('panels.remnawave.RemnawaveAPI',return_value=panel))
        self.assertEqual(await rotation.rotate_link(self.session,self.key),'fixture-new')
        panel.revoke_user_subscription.assert_awaited_once_with('fixture',username='fixture')
        panel.aclose.assert_awaited_once()
        self.assertEqual(self.key.key,self.key.remnawave_link)

    async def test_rebuild_target(self):
        from core.bootstrap import MODES_CONFIG
        self.start(patch.dict(MODES_CONFIG, COUNTRY_SELECTION_ENABLED=True))
        self.start(patch('database.servers.get_servers',AsyncMock(return_value={'cluster':[{'server_name':'node'}]})))
        tariffs=self.start(patch('database.get_tariffs_for_cluster',AsyncMock(return_value=[])))
        native=self.start(patch('api.v2.routes.keys.admin_subs.sub_reissue',new_callable=AsyncMock))
        rebuild=self.routes['rebuildPOST']
        body=m.Rebuild(revision=m.link_revision(self.key),cluster='cluster',node='node')
        with self.assertRaises(HTTPException): await rebuild('fixture',body,object(),self.session)
        native.assert_not_awaited()
        tariffs.return_value=[{'id':13}]
        self.session.scalar.return_value='replacement-id'
        result=await rebuild('fixture',body,object(),self.session)
        self.assertEqual(result['client_id'],'replacement-id')
        self.assertEqual(native.await_args.kwargs['payload'],{'cluster':'node'})

    async def test_delivery_recipient_and_failure(self):
        import sys
        telegram=AsyncMock()
        self.start(patch.dict(sys.modules,{'bot':SimpleNamespace(bot=telegram)}))
        chat=self.start(patch('database.access.resolution.chat_id_for_user',AsyncMock(return_value=111)))
        self.assertTrue(await rotation.notify_owner(self.session,10,'/subscription/a?x=1&y=2'))
        self.assertEqual(telegram.send_message.await_args.kwargs['chat_id'],111)
        self.assertIn('x=1&amp;y=2',telegram.send_message.await_args.kwargs['text'])
        chat.return_value=None
        self.assertFalse(await rotation.notify_owner(self.session,10,'x'))
        self.assertEqual(telegram.send_message.await_count,1)
        chat.return_value=111
        telegram.send_message.side_effect=RuntimeError()
        self.assertFalse(await rotation.notify_owner(self.session,10,'x'))

    async def test_3xui_nodes(self):
        nodes=[{'panel_type':'3x-ui','server_name':n,'api_url':'test','inbound_id':1} for n in ('one','two')]
        self.start(patch('database.servers.get_servers',AsyncMock(return_value={'cluster':nodes})))
        self.start(patch('handlers.utils.generate_random_email',AsyncMock(return_value='new-name')))
        owner=self.start(patch('database.access.resolution.subscription_owner_ref',AsyncMock(return_value=42)))
        self.start(patch('database.keys.invalidate_key_email',new_callable=AsyncMock))
        self.start(patch('panels._3xui.get_xui_instance',AsyncMock(return_value=object())))
        change=self.start(patch('panels._3xui.change_client_email',AsyncMock(return_value=True)))
        link=await rotation.rotate_link(self.session,self.key)
        self.assertEqual(change.await_count,2)
        owner.assert_awaited_once_with(self.session,10)
        self.assertTrue(link.endswith('/new-name/42'))
        self.assertEqual(self.key.key,link)
