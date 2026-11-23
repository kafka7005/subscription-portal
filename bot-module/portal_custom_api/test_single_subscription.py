"""Run in the bot environment. No database, provider, or Telegram calls."""
import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from sqlalchemy.dialects import postgresql

from . import single_subscription as policy


class PolicyTests(unittest.IsolatedAsyncioTestCase):
    async def test_serializes_two_balance_purchases(self):
        lock = asyncio.Lock()
        keys = []
        class Session:
            async def execute(self, query):
                self.owns_lock = True
                await lock.acquire()
                assert 'FOR UPDATE' in str(query.compile(dialect=postgresql.dialect()))
            async def scalar(self, query):
                assert 'keys.user_id' in str(query.compile(dialect=postgresql.dialect()))
                return next(iter(keys), None)
        async def purchase():
            session = Session()
            try:
                await policy.check_purchase(None, session)
                await asyncio.sleep(0)
                keys.append('client')
                return 200
            except HTTPException as error:
                return error.status_code
            finally:
                if getattr(session, 'owns_lock', False):
                    lock.release()
        with patch.object(policy, 'is_single_sub_enabled', return_value=True), patch.object(
            policy.identities, 'ensure_billing_user_for_identity', AsyncMock(return_value=27)
        ):
            self.assertEqual(sorted(await asyncio.gather(purchase(), purchase())), [200, 409])
            self.assertEqual(len(keys), 1)

    async def test_disabled_and_renewal(self):
        with patch.object(policy, 'is_single_sub_enabled', return_value=False):
            await policy.check_purchase(None, None)
        with patch.object(policy, 'check_purchase', AsyncMock()) as guard:
            for flow in ['balance_topup', 'key_addons', 'key_renewal', 'gift_create']:
                await policy.check_link(SimpleNamespace(metadata={'payment_flow':flow}), None, None)
            guard.assert_not_awaited()
            await policy.check_link(SimpleNamespace(metadata={'payment_flow':'tariff_purchase'}), None, None)
            guard.assert_awaited_once()

    async def test_paid_callbacks(self):
        from database import temporary_data, payments
        from services.payments import checkout_intent, pipeline
        session = object()
        cart = {'state':'waiting_for_payment','data':{'payment_flow':'trial_purchase'}}
        with (patch.object(policy, 'is_single_sub_enabled', return_value=True),
              patch.object(policy, 'maybe_sync_runtime_configs', AsyncMock()),
              patch.object(policy, 'has_subscription', AsyncMock(return_value=True)) as exists,
              patch.object(payments, 'resolve_payment_creation_owner', AsyncMock(return_value=27)),
              patch.object(temporary_data, 'get_temporary_data', AsyncMock(return_value=cart)),
              patch.object(checkout_intent, 'create_vpn_key_headless', AsyncMock()) as create,
              patch.object(pipeline, 'send_payment_success_notification', AsyncMock()) as notify):
            create._single_subscription_guard = notify._single_subscription_guard = False
            policy.install_completion_guard()
            guard = checkout_intent.create_vpn_key_headless
            policy.install_completion_guard()
            self.assertIs(checkout_intent.create_vpn_key_headless, guard)
            with self.assertRaises(policy.ValidationError):
                await guard(session=session, tg_id=27)
            create.assert_not_awaited()
            await pipeline.send_payment_success_notification(27, 149, session, use_temporary_checkout=True)
            self.assertIs(notify.await_args.kwargs['use_temporary_checkout'], False)
            exists.return_value = False
            await guard(session=session, tg_id=27)
            create.assert_awaited_once()
            await pipeline.send_payment_success_notification(27, 149, session, use_temporary_checkout=True)
            self.assertIs(notify.await_args.kwargs['use_temporary_checkout'], True)
