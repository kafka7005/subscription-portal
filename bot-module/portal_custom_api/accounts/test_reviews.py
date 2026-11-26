"""Local API contract tests with synthetic accounts and an in-memory SQL database."""
import importlib.util
import sys
import unittest
from contextlib import ExitStack
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool


class ReviewTests(unittest.TestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        engine = create_engine("sqlite://", poolclass=StaticPool,
                               connect_args={"check_same_thread": False})
        stack.callback(engine.dispose)
        conn = stack.enter_context(engine.connect())
        conn.execute(text("CREATE TABLE identities (id varchar(36) PRIMARY KEY)"))
        conn.execute(text("INSERT INTO identities VALUES ('first'), ('second')"))
        conn.connection.driver_connection.create_function("to_regclass", 1, lambda _: 1)

        class Session:
            async def commit(self):
                pass  # Each fixture request owns a SQLite savepoint.
            async def scalar(self, sql):
                return conn.scalar(sql)
            async def execute(self, sql, params=None):
                return conn.execute(sql, params or {})

        async def session():
            with conn.begin_nested():
                yield Session()

        async def user(request: Request):
            key = request.headers.get("Fixture-User")
            if not key:
                raise HTTPException(401)
            return SimpleNamespace(id=key)

        async def admin(request: Request):
            actor = await user(request)
            if actor.id != "staff":
                raise HTTPException(403)
            return actor

        settings = {}
        async def get_setting(session, key, default):
            return settings.get(key, default)
        async def set_setting(session, key, value, description):
            settings[key] = value

        self.credit = AsyncMock(return_value=42)
        self.permission = AsyncMock()
        modules = {}
        for name, values in {
            "api.depends": dict(get_session=session, verify_identity_admin=admin, verify_identity_token=user),
            "api.admin_permissions": dict(require_admin_action=self.permission),
            "filters.permissions": dict(PERM_USER_BALANCE="balance"),
            "database.identities": dict(ensure_billing_user_for_identity=AsyncMock(return_value=101),
                                        get_identity_by_id=AsyncMock(return_value=SimpleNamespace(id="first"))),
            "database.users": dict(update_balance=self.credit),
            "review_tests.site_activity": dict(defer_account_balance=lambda session, uid: None),
            "api.ratelimit": dict(enforce_rate_limit=AsyncMock()),
            "database.settings": dict(get_setting=get_setting, set_setting=set_setting),
        }.items():
            module = ModuleType(name)
            module.__dict__.update(values)
            modules[name] = module
        spec = importlib.util.spec_from_file_location("review_tests.accounts.target", Path(__file__).with_name("reviews.py"))
        target = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, modules):
            spec.loader.exec_module(target)
        self.notices = AsyncMock(return_value=["staff"])
        self.push = AsyncMock()
        self.target = target
        target.record_review_notices = self.notices
        target.push_review_notices = self.push
        conn.execute(text(target.CREATE))
        conn.execute(text(target.CREATE_REWARDS))
        app = FastAPI()
        app.include_router(target.get_router("/test"))
        self.client = stack.enter_context(TestClient(app))
        self.base = "/test/reviews"
        self.body = dict(author="Alias", body="Synthetic review", rating=4, consent=True)

    def request(self, method, route, actor=None, **kwargs):
        return self.client.request(method, self.base + route, headers={"Fixture-User":actor} if actor else {}, **kwargs)

    def test_publication_lifecycle_and_access(self):
        self.assertEqual(self.request("PUT", "/mine", json=self.body).status_code, 401)
        self.assertEqual(self.request("GET", "/admin", "first").status_code, 403)
        self.assertEqual(self.request("PUT", "/admin/visibility", "first", json={"enabled":True}).status_code, 403)
        item = self.request("PUT", "/mine", "first", json=self.body).json()["review"]
        self.assertEqual(item["status"], "pending")
        self.assertIsNone(self.request("GET", "/mine", "second").json()["review"])
        self.assertEqual(self.request("PUT", "/mine", "first", json=self.body).status_code, 409)
        admin_url = "/admin/" + item["id"]
        decision = {"status":"approved", "revision":item["revision"]}
        self.assertEqual(self.request("PUT", admin_url, "second", json=decision).status_code, 403)
        self.request("PUT", "/admin/visibility", "staff", json={"enabled":True}).raise_for_status()
        self.assertEqual(self.request("GET", "/public").json()["items"], [])
        self.request("PUT", admin_url, "staff", json=decision).raise_for_status()
        self.assertEqual(self.request("GET", "/public").json()["items"], [
            {"author":"Alias", "body":"Synthetic review", "rating":4}])
        self.request("PUT", "/admin/visibility", "staff", json={"enabled":False}).raise_for_status()
        self.assertEqual(self.request("GET", "/public").json()["items"], [])
        self.request("PUT", "/admin/visibility", "staff", json={"enabled":True}).raise_for_status()
        item = self.request("GET", "/mine", "first").json()["review"]
        rev = {"revision":item["revision"]}
        self.assertEqual(self.request("DELETE", "/mine", "first", params=rev).status_code, 405)
        self.assertEqual(self.request("PUT", "/mine", "first", json={**self.body, **rev}).status_code, 409)
        self.assertEqual(self.request("DELETE", admin_url, "second", params=rev).status_code, 403)
        self.assertEqual(self.request("DELETE", admin_url, "staff", params={"revision":decision["revision"]}).status_code, 409)
        self.assertEqual(len(self.request("GET", "/public").json()["items"]), 1)
        self.request("DELETE", admin_url, "staff", params=rev).raise_for_status()
        self.assertEqual(self.request("GET", "/public").json()["items"], [])
        self.assertIsNone(self.request("GET", "/mine", "first").json()["review"])
        self.assertEqual(self.request("GET", "/admin?status=approved", "staff").json()["items"], [])

    def test_reward_lifecycle(self):
        def submit():
            return self.request("PUT", "/mine", "first", json={**self.body, "rating":1}).json()["review"]

        def decide(item, status):
            return self.request("PUT", "/admin/" + item["id"], "staff",
                                json={"revision":item["revision"], "status":status})

        self.assertEqual(self.request("GET", "/mine", "first").json()["reward_rub"], 0)
        for invalid in [-1, True, 2.5, 10001]:
            self.assertEqual(self.request("PUT", "/admin/reward", "staff", json={"reward_rub":invalid}).status_code, 422)
        self.assertEqual(self.request("PUT", "/admin/reward", "first", json={"reward_rub":30}).status_code, 403)
        self.request("PUT", "/admin/reward", "staff", json={"reward_rub":30}).raise_for_status()
        item = submit()
        self.assertEqual(decide(item, "hidden").json()["awarded_rub"], 0)
        item = self.request("GET", "/mine", "first").json()["review"]
        self.permission.side_effect = HTTPException(403)
        self.assertEqual(decide(item, "approved").status_code, 403)
        self.credit.assert_not_awaited()
        self.permission.side_effect = None
        self.credit.return_value = None
        self.assertEqual(decide(item, "approved").status_code, 409)
        self.assertEqual(self.request("GET", "/mine", "first").json()["awarded_rub"], 0)
        self.credit.reset_mock()
        self.credit.return_value = 30
        self.assertEqual(decide(item, "approved").json()["awarded_rub"], 30)
        self.assertEqual(decide(item, "approved").status_code, 409)
        mine = self.request("GET", "/mine", "first").json()
        self.assertEqual(mine["awarded_rub"], 30)
        self.request("DELETE", "/admin/" + item["id"], "staff", params={"revision":mine["review"]["revision"]}).raise_for_status()
        self.assertEqual(decide(submit(), "approved").json()["awarded_rub"], 0)
        self.credit.assert_awaited_once()
        self.assertEqual(self.credit.await_args.args[1:], (101, 30))

    def test_new_review_alert_once(self):
        self.assertEqual(self.request("PUT", "/mine", "first", json={**self.body, "consent": False}).status_code, 422)
        self.notices.assert_not_awaited()
        item = self.request("PUT", "/mine", "first", json=self.body).json()["review"]
        self.assertEqual(self.request("PUT", "/mine", "first", json=self.body).status_code, 409)
        self.request("PUT", "/admin/" + item["id"], "staff", json={"revision":item["revision"], "status":"hidden"}).raise_for_status()
        self.notices.assert_awaited_once()
        self.push.assert_awaited_once_with(["staff"], item["id"])

    def test_review_alert_admin_roles(self):
        import asyncio
        role = AsyncMock()
        dependencies = ModuleType("api.depends")
        dependencies.resolve_identity_role = role
        with patch.dict(sys.modules, {"api.depends": dependencies}):
            for enabled, name, allowed in [(False, "user", False), (True, "designer", False),
                                           (True, "moderator", False), (True, "admin", True)]:
                role.return_value = name
                actor = SimpleNamespace(is_admin=enabled)
                self.assertEqual(asyncio.run(self.target.can_review(None, actor)), allowed)
            self.permission.side_effect = HTTPException(403)
            self.assertFalse(asyncio.run(self.target.can_review(None, actor)))

    def test_invalid_fields(self):
        for fields in [dict(consent=False), dict(body="     "), dict(author=""), dict(rating=0),
                       dict(rating=6), dict(rating=True), dict(body="x"*401)]:
            with self.subTest(fields=list(fields)):
                self.assertEqual(self.request("PUT", "/mine", "first", json={**self.body, **fields}).status_code, 422)
        self.assertIsNone(self.request("GET", "/mine", "first").json()["review"])


if __name__ == "__main__":
    unittest.main()
