"""All storage and provider-facing services mocked. Never submits a real charge."""
import importlib.util
import pathlib
import sys
import types
import unittest
from contextlib import asynccontextmanager
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError

spec=importlib.util.spec_from_file_location('manual_autopay',pathlib.Path(__file__).with_name('manual_autopay.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def stub(name,**values):
    parts=name.split('.')
    for i in range(1,len(parts)+1):
        key='.'.join(parts[:i])
        if key not in sys.modules:
            sys.modules[key]=types.ModuleType(key);sys.modules[key].__path__=[]
        if i>1:setattr(sys.modules['.'.join(parts[:i-1])],parts[i-1],sys.modules[key])
    for key,value in values.items():setattr(sys.modules[name],key,value)


class PolicyTests(unittest.TestCase):
    def test_grant_binds_uuid_amount_and_period(self):
        request_id=str(uuid4());body=module.ManualRequest(request_id=request_id,accepted_amount=149,accepted_period_days=30)
        grant={'request_id':request_id,'amount':'149.00','period_days':30}
        module.check_grant(grant,body)
        for key,value in [('amount','150'),('period_days',180),('request_id',str(uuid4()))]:
            with self.assertRaises(HTTPException):module.check_grant({**grant,key:value},body)

    def test_funding_uses_balance_first_without_exceeding_total(self):
        for balance,reserved,charge in [('0','0','149'),('50','50','99'),('149','149','0'),('148.50','148','1')]:
            result=module.charge_parts(Decimal(balance),Decimal('149'),Decimal('1'))
            self.assertEqual(result,(Decimal(reserved),Decimal(charge)))
        with self.assertRaises(HTTPException):module.charge_parts(Decimal('-1'),Decimal('149'),Decimal('1'))

    def test_invalid_approved_amounts_are_rejected(self):
        for amount in ['NaN','Infinity','0','-1','149.001']:
            with self.assertRaises(ValidationError):module.ManualRequest(request_id=uuid4(),accepted_amount=amount,accepted_period_days=30)


class PreparationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.request_id=str(uuid4())
        self.body=module.ManualRequest(request_id=self.request_id,accepted_amount=149,accepted_period_days=30)
        self.grant={'user_id':12,'subscription_id':9,'telegram_id':10101}
        self.session=SimpleNamespace()
        @asynccontextmanager
        async def maker():yield self.session
        self.owner=SimpleNamespace(id=12,tg_id=10101,balance=0)
        self.sub=SimpleNamespace(user_id=12,is_active=True,is_processing=False,retry_count=0,period_days=30,amount=149,accepted_gross_amount=149,card_id='owned-card',client_id='owned-key')
        self.dal=SimpleNamespace(get_owner=AsyncMock(return_value=self.owner),get_attempt=AsyncMock(return_value=None),get_subscription=AsyncMock(return_value=self.sub),get_open_subscription_attempt=AsyncMock(return_value=None),get_legacy_pending=AsyncMock(return_value=[]),get_owned_key=AsyncMock(return_value=SimpleNamespace()),get_owned_card=AsyncMock(return_value=SimpleNamespace(id='owned-card')),prepare_attempt=AsyncMock(return_value=SimpleNamespace(id=self.request_id)),append_log=AsyncMock())
        self.svc=SimpleNamespace(is_yookassa_autopay_enabled_for_session=AsyncMock(return_value=True),YOOKASSA_AUTOPAY_CONFIG={},quote_autopay_for_key=AsyncMock(return_value={'amount':149,'period_days':30,'expiry_ms':1000,'amount_quote':{'fee_percent':0}}),money=lambda x:Decimal(str(x)).quantize(Decimal('.01')),quote_yookassa_amount=lambda *a,**k:SimpleNamespace(gross=Decimal('149'),metadata=lambda:{}),checkout_key_snapshot=lambda k:{'key':'snapshot'},YOOKASSA_AMOUNTS='quote',_payload=AsyncMock(return_value={'amount':{'value':'149.00'}}),_commit=AsyncMock())
        self.balance=AsyncMock()
        self.patcher=patch.dict(sys.modules)
        self.patcher.start()
        stub('database',async_session_maker=maker,yookassa_autopay=self.dal)
        stub('database.access.resolution',UserId=int)
        stub('database.users',update_balance=self.balance)
        stub('services.payments.yookassa_autopay',service=self.svc)

    async def asyncTearDown(self):self.patcher.stop()

    async def test_prepare_is_scoped_to_grant_and_uses_same_native_attempt_id(self):
        result=await module.prepare(self.grant,self.body)
        self.assertEqual(result,self.request_id)
        self.svc._payload.assert_awaited_once_with(self.session,self.owner,Decimal('149'),self.request_id,card_id='owned-card')
        args=self.dal.prepare_attempt.call_args.kwargs
        self.assertEqual(args['attempt_id'],self.request_id)
        self.assertEqual(args['idempotency_key'],self.request_id)
        self.assertEqual(args['subscription_id'],9)
        self.balance.assert_not_awaited()

    async def test_replay_never_prepares_or_reserves_again(self):
        self.dal.get_attempt.return_value=SimpleNamespace(user_id=12,subscription_id=9,intent={'portal_manual':True},id=self.request_id)
        self.assertEqual(await module.prepare(self.grant,self.body),self.request_id)
        self.dal.prepare_attempt.assert_not_awaited();self.balance.assert_not_awaited()

    async def test_changed_owner_or_price_blocks_before_payload(self):
        self.owner.tg_id=999
        with self.assertRaises(HTTPException):await module.prepare(self.grant,self.body)
        self.owner.tg_id=10101
        self.svc.quote_autopay_for_key.return_value['amount']=150
        with self.assertRaises(HTTPException):await module.prepare(self.grant,self.body)
        self.svc._payload.assert_not_awaited();self.dal.prepare_attempt.assert_not_awaited()

    async def test_other_pending_attempt_blocks_before_provider_payload(self):
        self.dal.get_open_subscription_attempt.return_value=SimpleNamespace(id='other')
        with self.assertRaises(HTTPException):await module.prepare(self.grant,self.body)
        self.svc._payload.assert_not_awaited()

    async def test_fully_covered_balance_does_not_create_unneeded_card_attempt(self):
        self.owner.balance=149
        with self.assertRaises(HTTPException):await module.prepare(self.grant,self.body)
        self.svc._payload.assert_not_awaited();self.dal.prepare_attempt.assert_not_awaited()

    async def test_changed_preview_funding_rejects_before_preparing(self):
        self.grant['expected_snapshot']={'reserved':'50.00'}
        with self.assertRaises(HTTPException):await module.prepare(self.grant,self.body)
        self.svc._payload.assert_not_awaited();self.dal.prepare_attempt.assert_not_awaited()

    async def test_commission_needs_explicit_gross_ceiling(self):
        self.sub.accepted_gross_amount=151
        self.svc.quote_yookassa_amount=lambda *a,**k:SimpleNamespace(gross=Decimal('151'),metadata=lambda:{})
        with self.assertRaises(HTTPException):await module.prepare(self.grant,self.body)
        self.svc._payload.assert_not_awaited()
        self.body.accepted_gross_amount=Decimal('151')
        await module.prepare(self.grant,self.body)
        self.svc._payload.assert_awaited_once_with(self.session,self.owner,Decimal('151'),self.request_id,card_id='owned-card')


if __name__=='__main__':unittest.main()
