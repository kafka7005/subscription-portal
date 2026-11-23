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
        panel.bind_subscription = MagicMock()
        panel.get_user_by_uuid.side_effect = [
            {'uuid':'fixture','username':'fixture','subscriptionUrl':'old'},
            {'uuid':'new-panel-id','username':'fixture','subscriptionUrl':'fixture-new'},
            {'uuid':'other','username':'stranger','subscriptionUrl':'fixture-next'},
            {'uuid':'other','username':'fixture','subscriptionUrl':'outdated'},
        ]
        panel.revoke_user_subscription.side_effect = [{'subscriptionUrl':'fixture-new'},{'subscriptionUrl':'fixture-next'}]
        self.start(patch('panels.remnawave.RemnawaveAPI',return_value=panel))
        self.assertEqual(await rotation.rotate_link(self.session,self.key),'fixture-new')
        panel.revoke_user_subscription.assert_awaited_once_with('fixture',username='fixture')
        self.assertEqual(await rotation.rotate_link(self.session,self.key),'fixture-next')
        panel.bind_subscription.assert_called_with('fixture','fixture','fixture-new')
        self.assertEqual(panel.revoke_user_subscription.await_args.args, ('new-panel-id',))
        for _ in range(2):
            with self.assertRaises(HTTPException):
                await rotation.rotate_link(self.session,self.key)
        self.assertEqual(panel.revoke_user_subscription.await_count,2)
        self.assertEqual(panel.aclose.await_count,4)
        self.assertEqual(self.key.key,self.key.remnawave_link)

    async def test_rotations_across_channels(self):
        from .telegram_rotation import rotation_scope

        self.start(patch('database.servers.get_servers',AsyncMock(return_value={'cluster':[{'panel_type':'remnawave','api_url':'fixture'}]})))
        lock = self.start(patch('database.keys.lock_owned_key_for_operation', AsyncMock(return_value=self.key)))
        panel = AsyncMock()
        bound = {}
        record = {'uuid':'fixture', 'username':'fixture', 'subscriptionUrl':'old'}
        panel.bind_subscription = MagicMock(side_effect=lambda identity,name,link: bound.update(link=link))
        async def lookup(identity,username):
            return dict(record) if record['subscriptionUrl'] == bound.get('link') else None
        async def revoke(identity,username):
            self.assertEqual((identity,username),(record['uuid'],'fixture'))
            record.update(uuid=record['uuid']+'-r', subscriptionUrl=record['subscriptionUrl']+'-r')
            return dict(record)
        panel.get_user_by_uuid.side_effect = lookup
        panel.revoke_user_subscription.side_effect = revoke
        self.start(patch('panels.remnawave.RemnawaveAPI',return_value=panel))
        from handlers.admin.users.users_keys import lifecycle
        from .telegram_rotation import install
        self.start(patch.object(lifecycle,'remnawave_panel',SimpleNamespace(RemnawaveAPI=lambda url: panel)))
        self.start(patch.object(lifecycle,'resolve_callback_key',AsyncMock(return_value=self.key)))
        self.start(patch.object(lifecycle,'get_servers',AsyncMock(return_value={'cluster':[{'panel_type':'remnawave','api_url':'fixture'}]})))
        self.start(patch.object(lifecycle,'chat_id_for_user',AsyncMock(return_value=111)))
        self.start(patch.object(lifecycle,'admin_action_allowed',return_value=False))
        async def save_native_link(session,email,link):
            self.key.key = self.key.remnawave_link = link
            return True
        self.start(patch.object(lifecycle,'update_key_subscription_links',side_effect=save_native_link))
        with patch.object(lifecycle.router.callback_query,'middleware') as register:
            install()
            install()
            register.assert_called_once_with(rotation_scope)
        adapter = lifecycle.remnawave_panel
        event = SimpleNamespace(data='confirm_recreate|u10|fixture',message=AsyncMock(),bot=AsyncMock())
        async def native_callback(event,data):
            await lifecycle.handle_recreate_key_confirm(event, data['session'], data['admin_user_ref'])
        async def web():
            return await rotation.rotate_link(self.session,self.key)
        async def telegram():
            await rotation_scope(native_callback, event, {'session':self.session,'admin_user_ref':10})
        await web()
        await telegram()
        await web()
        await telegram()
        self.assertEqual(self.key.key,'old-r-r-r-r')
        self.assertEqual(event.bot.send_message.await_count,2)
        self.assertEqual(lock.await_count,2)
        self.assertEqual(panel.revoke_user_subscription.await_count,4)
        self.assertIs(adapter.RemnawaveAPI('fixture'),panel)

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
        sent = telegram.send_message.await_args.kwargs
        self.assertEqual(sent['chat_id'], 111)
        self.assertEqual(sent['parse_mode'], 'HTML')
        self.assertEqual(sent['text'], (
            '🔄 <b>Ваша подписка была перевыпущена</b>\n\n'
            '🔗 <b>Новая ссылка подписки:</b>\n'
            '<code>/subscription/a?x=1&amp;y=2</code>\n\n'
            '<i>Старая ссылка больше не работает.</i>'
        ))
        buttons = [[(b.text, b.callback_data) for b in row] for row in sent['reply_markup'].inline_keyboard]
        self.assertEqual(buttons, [[('📱 Мои подписки', 'view_keys')], [('👤 Личный кабинет', 'profile')]])
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
