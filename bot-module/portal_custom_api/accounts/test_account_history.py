"""Read-only history endpoints against an isolated, in-memory database."""
import asyncio
import importlib.util
import sys
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy import JSON, Column, DateTime, Float, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base

Base = declarative_base()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    identity_id = Column(String)


class Bonus(Base):
    __tablename__ = "bonuses"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    created_at = Column(DateTime)
    amount = Column(Float)


class Event(Base):
    __tablename__ = "events"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    created_at = Column(DateTime)
    price_rub = Column(Float)
    source = Column(String)
    event_type = Column(String)


class Payment(Base):
    __tablename__ = "payments"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer)
    created_at = Column(DateTime)
    amount = Column(Float)
    currency = Column(String)
    status = Column(String)
    payment_system = Column(String)
    metadata_ = Column(JSON)


class Ticket(Base):
    __tablename__ = "tickets"
    id = Column(String, primary_key=True)
    identity_id = Column(String)
    created_at = Column(DateTime)
    subject = Column(String)
    status = Column(String)


def stub(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    return module


def route(file, suffix):
    spec = importlib.util.spec_from_file_location(file, (Path(__file__).parent.parent / ("support" if file == "support_tools" else "accounts") / (file + ".py")))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return next(r for r in mod.get_router().routes if r.path.endswith(suffix))


class HistoryTests(unittest.TestCase):
    def setUp(self):
        engine = create_engine("sqlite://")
        self.addCleanup(engine.dispose)
        Base.metadata.create_all(engine)
        self.db = Session(engine)
        self.addCleanup(self.db.close)
        self.session = types.SimpleNamespace(execute=AsyncMock(side_effect=self.db.execute),
                                             scalar=AsyncMock(side_effect=self.db.scalar))
        self.identity = types.SimpleNamespace(id="owner")
        self.deps = stub("api.depends", get_session=lambda: None, get_request_actor=lambda request: None,
                         verify_identity_agent=lambda: None, verify_identity_token=lambda: None)
        mods = {m.__name__: m for m in [
            self.deps, stub("database.models", User=User), stub("database.models.bonuses", DailyBonusClaim=Bonus),
            stub("database.models.payments", Payment=Payment), stub("database.models.subscription_events", SubscriptionEvent=Event),
            stub("database.models.tickets", Ticket=Ticket),
            stub("services.tickets", get_ticket=AsyncMock(side_effect=lambda session, key: self.db.get(Ticket, key))),
        ]}
        self.enterContext(patch.dict(sys.modules, mods))
        self.day = datetime(2026, 1, 1)

    def test_balance_signs_owner_and_pagination(self):
        self.db.add_all([User(id=1, identity_id="owner"), User(id=2, identity_id="other"),
                         Bonus(id=1, user_id=1, amount=3, created_at=self.day),
                         Bonus(id=2, user_id=2, amount=99, created_at=self.day)])
        for index, (kind, price, source) in enumerate([
            ("renewed", -20, "web"), ("renewed", 50, "web"), ("created", 500, "web"),
            ("addons", 10, "web"), ("created", 900, "backfill")], 1):
            self.db.add(Event(id=index, user_id=1, event_type=kind, price_rub=price, source=source, created_at=self.day))
        for index, (status, flow) in enumerate([("success","balance_topup"),("pending","balance_topup"),("success","renewal")], 1):
            self.db.add(Payment(id=index, user_id=1, amount=40, currency="RUB", status=status, payment_system="provider",
                                metadata_={"payment_flow":flow}, created_at=self.day))
        self.db.commit()
        handler = route("customer_tools", "/balance-history")
        self.assertIn(self.deps.verify_identity_token, [d.call for d in handler.dependant.dependencies])
        def page(offset):
            return asyncio.run(handler.endpoint(None, self.identity, self.session, 3, offset))
        a, b = page(0), page(3)
        self.assertTrue(a["has_more"])
        self.assertFalse(b["has_more"])
        rows = a["items"] + b["items"]
        self.assertEqual(len(rows), 6)
        self.assertEqual({r["kind"]: r["amount"] for r in rows},
                         {"bonus":3, "tariff_credit":20, "renewal":-50, "issued":None, "addons":-10, "topup":40})
        self.identity.id = "unlinked"
        self.assertEqual(page(0)["items"], [])

    def test_related_excludes_current_and_other_client(self):
        for key, owner in [("a","owner"), ("b","owner"), ("c","other")]:
            self.db.add(Ticket(id=key, identity_id=owner, subject="Same subject", status="closed", created_at=self.day))
        self.db.commit()
        handler = route("support_tools", "/related")
        self.assertIn(self.deps.verify_identity_agent, [d.call for d in handler.dependant.dependencies])
        data = asyncio.run(handler.endpoint("a", self.identity, self.session, 5, 0))
        self.assertEqual(data["total"], 1)
        self.assertEqual([r["id"] for r in data["items"]], ["b"])


if __name__ == "__main__":
    unittest.main()
