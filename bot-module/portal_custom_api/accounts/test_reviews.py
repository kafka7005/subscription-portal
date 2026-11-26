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
            async def scalar(self, sql):
                return conn.scalar(sql)
            async def execute(self, sql, params=None):
                return conn.execute(sql, params or {})

        async def session():
            return Session()

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

        modules = {}
        for name, values in {
            "api.depends": dict(get_session=session, verify_identity_admin=admin, verify_identity_token=user),
            "api.ratelimit": dict(enforce_rate_limit=AsyncMock()),
            "database.settings": dict(get_setting=get_setting, set_setting=set_setting),
        }.items():
            module = ModuleType(name)
            module.__dict__.update(values)
            modules[name] = module
        spec = importlib.util.spec_from_file_location("review_target", Path(__file__).with_name("reviews.py"))
        target = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, modules):
            spec.loader.exec_module(target)
        conn.execute(text(target.CREATE))
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
        self.assertEqual(self.request("DELETE", "/mine", "second", params={"revision":item["revision"]}).status_code, 409)
        self.request("PUT", "/mine", "first", json={**self.body, "body":"Revised words", "revision":item["revision"]}).raise_for_status()
        self.assertEqual(self.request("PUT", admin_url, "staff", json=decision).status_code, 409)
        self.assertEqual(self.request("GET", "/public").json()["items"], [])
        pending = self.request("GET", "/admin", "staff").json()["items"][0]
        self.request("PUT", admin_url, "staff", json={"status":"hidden","revision":pending["revision"]}).raise_for_status()
        hidden = self.request("GET", "/mine", "first").json()["review"]
        self.assertEqual(hidden["status"], "hidden")
        self.request("DELETE", "/mine", "first", params={"revision":hidden["revision"]}).raise_for_status()
        self.assertEqual(self.request("GET", "/admin?status=hidden", "staff").json()["items"], [])

    def test_invalid_fields(self):
        for fields in [dict(consent=False), dict(body="     "), dict(author=""), dict(rating=0),
                       dict(rating=6), dict(rating=True), dict(body="x"*401)]:
            with self.subTest(fields=list(fields)):
                self.assertEqual(self.request("PUT", "/mine", "first", json={**self.body, **fields}).status_code, 422)
        self.assertIsNone(self.request("GET", "/mine", "first").json()["review"])


if __name__ == "__main__":
    unittest.main()
