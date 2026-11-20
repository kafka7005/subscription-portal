"""No Telegram, payments, production records or publication in these tests."""
import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException


def stub(name, **attrs):
    mod = ModuleType(name)
    mod.__dict__.update(attrs)
    return mod


class GiveawayTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.identity = SimpleNamespace(tg_id=7, username="fixture", display_name="Tester")
        self.storage = SimpleNamespace(profile_button_enabled=AsyncMock(return_value=False),
                                       list_public_games=AsyncMock(return_value=[]), set_profile_button=AsyncMock(),
                                       get=AsyncMock(), entry=AsyncMock(return_value=None),
                                       partner_invite_counts=AsyncMock(return_value={}))
        self.service = SimpleNamespace(join=AsyncMock(return_value=(True,"ok")),username=AsyncMock(return_value="fixture"))
        self.deps=stub("api.depends", verify_identity_token=lambda:None, verify_identity_admin=lambda:None,
                       get_session=lambda:None)
        modules=[self.deps, stub("bot",bot=object()),stub("core.rate_limit",rate_limit_hit=AsyncMock(return_value=(1,False))),
                 stub("handlers.legal", is_legal_enabled=lambda:True, legal_accepted=AsyncMock(return_value=True)),
                 stub("modules.giveaways",storage=self.storage,service=self.service,render=SimpleNamespace(conditions=lambda r:"OK")),
                 stub("modules.giveaways.public",error=str),stub("modules.giveaways.eligibility",CheckUnavailable=TimeoutError),
                 stub("modules.giveaways.core",bonus_chances=lambda n,r:0),
                 stub("aiogram.exceptions",TelegramAPIError=ConnectionError)]
        self.enterContext(patch.dict(sys.modules,{m.__name__:m for m in modules}))
        spec=importlib.util.spec_from_file_location("web_giveaways",Path(__file__).with_name("giveaways.py"))
        self.mod=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.mod)
        self.enabled=self.enterContext(patch.object(self.mod,"available",return_value=True))
        self.super=self.enterContext(patch.object(self.mod,"superuser",AsyncMock(return_value=False)))
        self.routes=self.mod.get_router("/api/test").routes

    def endpoint(self,method,suffix):
        return next(r.endpoint for r in self.routes if method in r.methods and r.path=="/api/test/giveaways"+suffix)

    async def test_off_hides_index_but_preserves_direct_link(self):
        config=await self.endpoint("GET","/config")(self.identity,None)
        self.assertFalse(config["enabled"])
        with self.assertRaises(HTTPException) as fail:
            await self.endpoint("GET","")(0,self.identity,None)
        self.assertEqual(fail.exception.status_code,404)
        self.storage.list_public_games.assert_not_awaited()
        self.storage.get.return_value=dict(id=4,title="Game",description="",state="active",deadline=9999999999,
            deleted_at=None,commitment="hash",seed="private",prizes=[],rules=dict(min_invites=0,bonus_every=0,channels=[]))
        result=await self.endpoint("GET","/game/{gid}")(4,self.identity,None)
        self.assertNotIn("seed",result)
        self.storage.get.return_value["state"]="draft"
        with self.assertRaises(HTTPException):
            await self.endpoint("GET","/game/{gid}")(4,self.identity,None)
        self.storage.profile_button_enabled.return_value=True
        await self.endpoint("GET","")(0,self.identity,None)
        self.storage.list_public_games.assert_awaited_once_with(7,0)

    async def test_missing_module_and_admin_permissions(self):
        with self.assertRaises(HTTPException) as denied:
            await self.mod.staff(self.identity)
        self.assertEqual(denied.exception.status_code,403)
        for r in self.routes:
            if "/admin" in r.path or "PUT" in r.methods:
                self.assertIn(self.mod.staff,[d.call for d in r.dependant.dependencies])
        self.super.return_value=True
        self.assertEqual(await self.mod.staff(self.identity),7)
        self.enabled.return_value=False
        self.assertEqual(await self.endpoint("GET","/config")(self.identity,None),dict(enabled=False,manage=False))
        with self.assertRaises(HTTPException):
            await self.mod.staff(self.identity)

    async def test_join_requires_link_consent_and_uses_account_identity(self):
        join=self.endpoint("POST","/game/{gid}/join")
        with self.assertRaises(HTTPException):
            await join(4,SimpleNamespace(tg_id=None),None)
        legal=sys.modules["handlers.legal"].legal_accepted
        legal.return_value=False
        with self.assertRaises(HTTPException):
            await join(4,self.identity,None)
        self.service.join.assert_not_awaited()
        legal.return_value=True
        await join(4,self.identity,None)
        self.assertEqual(self.service.join.await_args.args[2].id,7)


if __name__=="__main__":
    unittest.main()
