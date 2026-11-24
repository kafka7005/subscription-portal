"""Run with the bot venv; all financial services and storage are mocked."""
import importlib.util
import pathlib
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError

# Keep this test process separate from the bot's startup/license loader.
# No production dependency or financial service is imported or executed.
def stub(name, **values):
    parts = name.split('.')
    for i in range(1, len(parts) + 1):
        key = '.'.join(parts[:i])
        if key not in sys.modules:
            sys.modules[key] = types.ModuleType(key)
            sys.modules[key].__path__ = []
        if i > 1:
            setattr(sys.modules['.'.join(parts[:i-1])], parts[i-1], sys.modules[key])
    for key, value in values.items(): setattr(sys.modules[name], key, value)

stub('api.depends', get_session=lambda: None, verify_identity_token=lambda: None)
stub('api.ratelimit', enforce_rate_limit=AsyncMock())
stub('api.v2.routes.partners', _resolve_partner_user=AsyncMock())
stub('core.redis_cache', _get_redis=AsyncMock())
stub('database.partners', get_partner_profile=AsyncMock())
stub('modules.partner_program.handlers.payments', move_partner_to_main=AsyncMock())
spec = importlib.util.spec_from_file_location('web_actions_test_target', pathlib.Path(__file__).with_name('web_actions.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Redis:
    def __init__(self): self.items = {}
    async def set(self, key, value, nx=False, ex=None):
        if nx and key in self.items: return False
        self.items[key] = value
        return True
    async def get(self, key): return self.items.get(key)
    async def delete(self, key): self.items.pop(key, None)


class TransferTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.redis = Redis()
        self.move = AsyncMock()
        self.profile = AsyncMock(return_value={'tg_id': 42, 'partner_balance': 100})
        self.cfg = {'enabled': True, 'custom_amount_enabled': True, 'min_amount_rub': 0}
        patches = [
            patch.object(module, 'completed_transfer', AsyncMock(return_value=None)),
            patch.object(module, 'record_transfer'),
            patch.object(module, 'transfer_options', return_value=self.cfg),
            patch('api.v2.routes.partners._resolve_partner_user', AsyncMock(return_value=(7, 42))),
            patch('core.redis_cache._get_redis', AsyncMock(return_value=self.redis)),
            patch('database.partners.get_partner_profile', self.profile),
            patch('modules.partner_program.handlers.payments.move_partner_to_main', self.move),
        ]
        for p in patches: p.start(); self.addCleanup(p.stop)
        self.endpoint = next(r.endpoint for r in module.get_router().routes if r.name == 'transfer')
        self.session = SimpleNamespace(rollback=AsyncMock())
        self.body = module.TransferBody(amount_rub='25.50', request_id=uuid4())

    async def call(self, body=None):
        return await self.endpoint(body or self.body, SimpleNamespace(), identity=SimpleNamespace(), session=self.session)

    async def test_duplicate_returns_receipt_without_second_transfer(self):
        first = await self.call()
        self.assertEqual(first, await self.call())
        self.move.assert_awaited_once_with(self.session, 42, 25.5)

    async def test_insufficient_balance_never_calls_financial_service(self):
        self.body.amount_rub = 101
        with self.assertRaises(HTTPException) as result: await self.call()
        self.assertEqual(result.exception.status_code, 400)
        self.move.assert_not_awaited()

    async def test_disabled_feature_never_moves_money(self):
        self.cfg['enabled'] = False
        with self.assertRaises(HTTPException) as result: await self.call()
        self.assertEqual(result.exception.status_code, 403)
        self.move.assert_not_awaited()

    async def test_uncertain_result_blocks_repeated_debit(self):
        self.move.side_effect = RuntimeError('simulated timeout')
        with self.assertRaises(HTTPException): await self.call()
        with self.assertRaises(HTTPException) as result: await self.call()
        self.assertEqual(result.exception.status_code, 409)
        self.assertEqual(self.move.await_count, 1)

    async def test_full_balance_only_setting(self):
        self.cfg['custom_amount_enabled'] = False
        with self.assertRaises(HTTPException): await self.call()
        self.move.assert_not_awaited()

    async def test_committed_receipt_survives_cache_failure(self):
        with patch.object(module, 'completed_transfer', AsyncMock(return_value={'amount':'25.50'})):
            self.assertTrue((await self.call())['ok'])
            self.move.assert_not_awaited()

    def test_invalid_amounts(self):
        for value in ('0', '-1', 'NaN', 'Infinity', '0.001'):
            with self.assertRaises(ValidationError): module.TransferBody(amount_rub=value, request_id=uuid4())


if __name__ == '__main__': unittest.main()
