"""Admin preview/confirm/status tests; no real sessions, storage or charges."""
import importlib.util
import json
import pathlib
import sys
import types
import unittest
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi import HTTPException

root=pathlib.Path(__file__).parent
package=types.ModuleType('portal_custom_api');package.__path__=[str(root)]
sys.modules['portal_custom_api']=package
def stub(name,**values):
    parts=name.split('.')
    for i in range(1,len(parts)+1):
        key='.'.join(parts[:i])
        if key not in sys.modules:
            sys.modules[key]=types.ModuleType(key);sys.modules[key].__path__=[]
        if i>1:setattr(sys.modules['.'.join(parts[:i-1])],parts[i-1],sys.modules[key])
    for key,value in values.items():setattr(sys.modules[name],key,value)
stub('api.depends',get_session=lambda:None,verify_identity_admin=lambda:None)
spec=importlib.util.spec_from_file_location('portal_custom_api.manual_autopay_admin',root/'manual_autopay_admin.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Redis:
    def __init__(self):self.values={}
    async def set(self,key,value,nx=False,ex=None):
        if nx and key in self.values:return False
        self.values[key]=value;return True
    async def get(self,key):return self.values.get(key)


class AdminPolicyTests(unittest.TestCase):
    def test_preview_is_bound_to_admin_owner_and_subscription(self):
        grant={'user_id':12,'subscription_id':9,'admin_identity_id':'admin'}
        module.validate_preview(grant,12,9,'admin')
        for args in [(None,12,9,'admin'),(grant,13,9,'admin'),(grant,12,10,'admin'),(grant,12,9,'other')]:
            with self.assertRaises(HTTPException):module.validate_preview(*args)

    def test_all_routes_require_admin_cookie_dependency(self):
        routes=module.get_router().routes
        self.assertEqual(len(routes),3)
        for route in routes:self.assertIn(sys.modules['api.depends'].verify_identity_admin,[d.call for d in route.dependant.dependencies])
        self.assertEqual(routes[-1].methods,{'GET'})


class AdminFlowTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.patcher=patch.dict(sys.modules);self.patcher.start()
        self.redis=Redis();self.identity=SimpleNamespace(id='admin',tg_id=123)
        self.session=SimpleNamespace(commit=AsyncMock())
        self.permissions=AsyncMock()
        self.sub=SimpleNamespace(id=9,user_id=12,is_active=True,is_processing=False,retry_count=0,
            period_days=30,amount=149,accepted_gross_amount=149,client_id='key',card_id='card')
        self.dal=SimpleNamespace(get_subscription=AsyncMock(return_value=self.sub),get_open_subscription_attempt=AsyncMock(return_value=None),get_legacy_pending=AsyncMock(return_value=[]),
            get_owner=AsyncMock(return_value=SimpleNamespace(tg_id=1,balance=0)),get_owned_key=AsyncMock(return_value=SimpleNamespace()),
            get_owned_card=AsyncMock(return_value=SimpleNamespace(id='card',card_mask='**** 4242')))
        self.svc=SimpleNamespace(is_yookassa_autopay_enabled_for_session=AsyncMock(return_value=True),YOOKASSA_AUTOPAY_CONFIG={},
            quote_autopay_for_key=AsyncMock(return_value={'amount':149,'period_days':30,'expiry_ms':2000000000000,'amount_quote':{'fee_percent':0}}),
            money=lambda x:Decimal(str(x)).quantize(Decimal('.01')),quote_yookassa_amount=lambda *a,**k:SimpleNamespace(gross=Decimal('149.00')),
            checkout_key_snapshot=lambda k:{'tariff':1},_submit_attempt=AsyncMock(return_value=SimpleNamespace(ok=True,error=None)))
        stub('core.redis_cache',_get_redis=AsyncMock(return_value=self.redis))
        stub('database',yookassa_autopay=self.dal)
        stub('database.access.resolution',UserId=int)
        stub('services.payments.yookassa_autopay',service=self.svc)
        stub('api.admin_permissions',require_admin_action=self.permissions)
        stub('filters.permissions',PERM_USER_BALANCE='balance')
        self.routes=[r.endpoint for r in module.get_router().routes]

    async def asyncTearDown(self):self.patcher.stop()

    async def preview(self):return await self.routes[0](user_id=12,subscription_id=9,identity=self.identity,session=self.session)

    async def test_preview_creates_only_bound_quote_and_never_submits(self):
        result=await self.preview()
        self.assertEqual(result['from_card'],'149.00');self.assertEqual(result['from_balance'],'0.00')
        grant=json.loads(next(iter(self.redis.values.values())))
        self.assertEqual(grant['admin_identity_id'],'admin');self.assertEqual(grant['user_id'],12)
        self.svc._submit_attempt.assert_not_awaited();self.permissions.assert_awaited_once()

    async def test_wrong_owner_or_disabled_provider_cannot_get_preview(self):
        self.sub.user_id=999
        with self.assertRaises(HTTPException):await self.preview()
        self.sub.user_id=12;self.svc.is_yookassa_autopay_enabled_for_session.return_value=False
        with self.assertRaises(HTTPException):await self.preview()
        self.svc._submit_attempt.assert_not_awaited()

    async def test_confirm_requires_checkbox_and_passes_same_quote_uuid(self):
        quote=await self.preview();body=module.ConfirmRequest(preview_id=quote['preview_id'],reason='Client request',confirmed=False)
        with self.assertRaises(HTTPException):await self.routes[1](body,user_id=12,subscription_id=9,identity=self.identity,session=self.session)
        body.confirmed=True
        with patch.object(module,'prepare',AsyncMock(return_value=quote['preview_id'])) as prepare,patch.object(module,'attempt_result',AsyncMock(return_value={'status':'applied'})):
            result=await self.routes[1](body,user_id=12,subscription_id=9,identity=self.identity,session=self.session)
        self.assertEqual(result['status'],'applied')
        self.assertEqual(str(prepare.call_args.args[1].request_id),quote['preview_id'])
        self.assertEqual(prepare.call_args.args[0]['reason'],'Client request')
        self.svc._submit_attempt.assert_awaited_once_with(quote['preview_id'])

    async def test_expired_preview_never_prepares_or_submits(self):
        body=module.ConfirmRequest(preview_id=uuid4(),reason='Client request',confirmed=True)
        with patch.object(module,'prepare',AsyncMock()) as prepare:
            with self.assertRaises(HTTPException):await self.routes[1](body,user_id=12,subscription_id=9,identity=self.identity,session=self.session)
            prepare.assert_not_awaited()
        self.svc._submit_attempt.assert_not_awaited()

    async def test_self_charge_releases_authentication_locks_before_payment_session(self):
        quote=await self.preview()
        locked=[True]
        async def release():locked[0]=False
        async def prepare(grant,request):
            if locked[0]:raise TimeoutError('Authentication transaction still holds the owner row')
            return str(request.request_id)
        self.session.commit.side_effect=release
        body=module.ConfirmRequest(preview_id=quote['preview_id'],reason='Owner request',confirmed=True)
        with patch.object(module,'prepare',prepare),patch.object(module,'attempt_result',AsyncMock(return_value={'status':'pending'})):
            result=await self.routes[1](body,user_id=12,subscription_id=9,identity=self.identity,session=self.session)
        self.assertEqual(result['status'],'pending')
        self.session.commit.assert_awaited_once()
        self.svc._submit_attempt.assert_awaited_once_with(quote['preview_id'])

    async def test_status_is_read_only(self):
        with patch.object(module,'attempt_result',AsyncMock(return_value={'status':'pending'})) as read:
            await self.routes[2](uuid4(),user_id=12,subscription_id=9,identity=self.identity,session=self.session)
            read.assert_awaited_once()
        self.svc._submit_attempt.assert_not_awaited()


if __name__=='__main__':unittest.main()
