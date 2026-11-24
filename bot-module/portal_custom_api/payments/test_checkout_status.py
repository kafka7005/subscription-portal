"""Receipt lifecycle tests with no provider, network or bot database."""
import importlib.util
from pathlib import Path
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import BaseModel


class Body(BaseModel):
    tariff_id: int = 1


class CheckoutTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        deps = {'api.depends': SimpleNamespace(get_session=None,verify_identity_token=None),
                'api.ratelimit': SimpleNamespace(enforce_rate_limit=AsyncMock()),
                'database.models': SimpleNamespace(AuditEvent=SimpleNamespace)}
        with patch.dict(sys.modules,deps):
            spec = importlib.util.spec_from_file_location('checkout',Path(__file__).with_name('checkout_status.py'))
            self.mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.mod)
        self.row = None
        self.session = SimpleNamespace(execute=AsyncMock(),commit=AsyncMock(),rollback=AsyncMock(),add=self.add)
        self.identity = SimpleNamespace(id='fixture')
        self.body = Body()
        self.op = uuid4()
        self.perform = AsyncMock(return_value=SimpleNamespace(ok=True,payment_url=None))
        self.mod.receipt = AsyncMock(side_effect=lambda *args:self.row)

    def add(self,row):
        self.row = row

    async def submit(self):
        return await self.mod.submit(self.op,'purchase',self.body,'',None,self.session,self.identity,self.perform)

    async def test_lost_response_returns_receipt_without_new_charge(self):
        await self.submit()
        self.assertEqual(await self.submit(),{'receipt_state':'completed'})
        self.perform.assert_awaited_once()

    async def test_external_payment_receipt_excludes_url(self):
        self.perform.return_value=SimpleNamespace(ok=True,payment_url='private-fixture',payment_id='payment-id')
        await self.submit()
        self.assertEqual(self.row.result,'payment_created')
        self.assertEqual(self.row.metadata_['payment_id'],'payment-id')
        self.assertNotIn('private-fixture',str(self.row.metadata_))

    async def test_failure_after_submission_blocks_retry(self):
        self.perform.side_effect=TimeoutError()
        with self.assertRaises(TimeoutError): await self.submit()
        self.assertEqual(await self.submit(),{'receipt_state':'processing'})
        self.perform.assert_awaited_once()

    async def test_validation_decline_and_changed_request(self):
        self.perform.side_effect=HTTPException(422,'invalid')
        with self.assertRaises(HTTPException): await self.submit()
        self.assertEqual(self.row.result,'declined')
        self.body=Body(tariff_id=2)
        self.assertEqual(await self.submit(),{'receipt_state':'different_parameters'})
        self.perform.assert_awaited_once()
