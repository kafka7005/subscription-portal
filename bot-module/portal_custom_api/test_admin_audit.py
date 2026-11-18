"""Isolated read-only query/security checks; no live database or bot startup."""
import importlib.util
import pathlib
import sys
import types
import unittest

from sqlalchemy import Column, Integer, MetaData, String, Table, select
from sqlalchemy.dialects import postgresql

api = types.ModuleType("api")
api.__path__ = []
depends = types.ModuleType("api.depends")
depends.get_session = lambda: None
depends.verify_identity_admin = lambda: None
sys.modules["api"] = api
sys.modules["api.depends"] = depends
spec = importlib.util.spec_from_file_location("admin_audit", pathlib.Path(__file__).with_name("admin_audit.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

table = Table("audit_events", MetaData(),
    Column("event_type", String), Column("actor_identity_id", String),
    Column("actor_tg_id", Integer), Column("entity_type", String),
    Column("entity_id", String), Column("channel", String), Column("result", String))


class AuditTests(unittest.TestCase):
    def compile(self, **kwargs):
        return select(table).where(*module.audit_filters(table.c, **kwargs)).compile(dialect=postgresql.dialect())

    def test_only_explicit_administrative_events(self):
        query = self.compile()
        self.assertIn("OR", str(query))
        self.assertIn("ESCAPE", str(query))
        self.assertIn("admin/_", query.params.values())
        self.assertIn("web_admin_action", query.params.values())

    def test_filters_are_bound_and_do_not_replace_admin_boundary(self):
        query = self.compile(actor="123", user_id=45, channel="api", result="success")
        for value in ("admin/_", "web_admin_action", "123", 123, "user", "45", "api", "success"):
            self.assertIn(value, query.params.values())
        malicious = "' OR 1=1 --"
        query = self.compile(actor=malicious)
        self.assertNotIn(malicious, str(query))
        self.assertIn(malicious, query.params.values())

    def test_route_is_read_only_and_requires_admin(self):
        routes = module.get_router().routes
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].methods, {"GET"})
        dependencies = [dep.call for dep in routes[0].dependant.dependencies]
        self.assertIn(depends.verify_identity_admin, dependencies)


if __name__ == "__main__":
    unittest.main()
