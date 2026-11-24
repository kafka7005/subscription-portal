import asyncio
import sys
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

from sqlalchemy import URL, Column, Integer, String, create_engine
from sqlalchemy.orm import Session, declarative_base

import site_activity as activity


class SiteActivityTests(unittest.TestCase):
    def test_access_log_selection(self):
        def quiet(method, path, **overrides):
            args = dict(status_code=200, duration_ms=15, result='success')
            return activity.routine_access(method, path, **{**args, **overrides})
        self.assertTrue(quiet('GET', '/api/auth/summary'))
        self.assertTrue(quiet('POST', '/api/web/analytics/page-views'))
        self.assertTrue(quiet('POST', '/api/keys/example/renew', preview=True))
        for method, path in [('POST','/api/keys/example/renew'), ('DELETE','/api/keys/example'),
                             ('POST','/api/partners/payouts/me'), ('GET','/api/payment/callback')]:
            self.assertFalse(quiet(method, path))
        self.assertFalse(quiet('GET','/api/auth/summary', status_code=403))
        self.assertFalse(quiet('GET','/api/auth/summary', duration_ms=1000))

    def test_native_log_imports(self):
        audit = ModuleType('audit')
        main = ModuleType('api.main')
        original = audit.log_api_access = main.log_api_access = Mock()
        with patch.dict(sys.modules, {'audit': audit, 'api.main': main}):
            activity.install_access_filter()
            activity.install_access_filter()
            self.assertIs(main.log_api_access, audit.log_api_access)
            request = SimpleNamespace(method='GET', url=SimpleNamespace(path='/api/auth/summary'), query_params={})
            main.log_api_access(request, status_code=200, duration_ms=10, result='success')
            original.assert_not_called()
            main.log_api_access(request, status_code=503, duration_ms=10, result='fail')
            original.assert_called_once()

    def test_transaction_owner_invalidation(self):
        base = declarative_base()

        class Key(base):
            __tablename__ = 'test_keys'
            user_id = Column(Integer, primary_key=True)
            client_id = Column(String, primary_key=True)
            expiry = Column(Integer)

        engine = create_engine(URL.create('sqlite'))
        base.metadata.create_all(engine)
        modules = {name: ModuleType(name) for name in ('database','database.models','database.access.resolution',
                   'database.cache_purge','database.partners','core.redis_cache')}
        modules['database'].partners = partners = modules['database.partners']
        original = partners.create_partner_payout = AsyncMock(return_value=(9, 30))
        modules['database.models'].Key = Key
        modules['database.access.resolution'].UserId = int
        modules['database.access.resolution'].user_ref_cache_key = lambda k,u: f'{k}:user:{u}'
        modules['core.redis_cache'].cache_key = lambda k,u: f'{k}:{u}'
        modules['database.cache_purge'].defer_purge = lambda s,*keys: s.info.setdefault('pending',set()).update(keys)
        from sqlalchemy import event
        with patch.dict(sys.modules, modules), patch.object(event, 'listen', wraps=event.listen) as listen:
            activity.install_cache_hooks()
            activity.install_cache_hooks()
            listener = listen.call_args.args[2]
            try:
                with Session(engine) as session:
                    key = Key(user_id=7, client_id='sample', expiry=15)
                    session.add(key)
                    session.flush()
                    self.assertIn('keys_list:user:7', session.info.pop('pending'))
                    key.expiry = 22
                    session.flush()
                    self.assertIn('key_count:user:7', session.info.pop('pending'))
                    session.delete(key)
                    session.flush()
                    self.assertIn('keys_list:user:7', session.info.pop('pending'))
                    self.assertEqual(asyncio.run(partners.create_partner_payout(session, 9, 12, 'bank', 'sample')), (9,30))
                    self.assertEqual(session.info['pending'], {'summary_counters:9','balance:user:9'})
                    original.assert_awaited_once()
            finally:
                event.remove(Session, 'after_flush', listener)
                engine.dispose()
