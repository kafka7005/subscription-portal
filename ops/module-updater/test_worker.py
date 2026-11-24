"""Integration checks with a local repository and a simulated bot service."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import patch

import worker


class ModuleUpdates(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.base = self.root/'state'
        (self.base/'inbox').mkdir(parents=True)
        (self.base/'private').mkdir()
        self.live = self.root/worker.MODULE
        self.live.mkdir()
        (self.live/'VERSION').write_text('1.7.0')
        self.config = dict(target=str(self.live))
        self.source = self.root/'release'
        self.git('init', '-q','-b','main',str(self.source))
        self.tree = self.source/worker.VERSION_PATH
        (self.tree/'staff').mkdir(parents=True)
        for path in ['api.py','router.py','__init__.py','staff/module_updates.py']:
            (self.tree/path).write_text('# fixture')
        (self.tree/'VERSION').write_text('1.8.0')
        (self.tree/'RELEASE.txt').write_text('Example release')
        self.commit()
        self.git('clone','--quiet','--bare',str(self.source),str(self.base/'private/source.git'))
        patcher = patch.object(worker,'BASE',self.base)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.restarts = []
        self.run_worker()

    def git(self,*args):
        subprocess.run(['git',*args],check=True,stdout=subprocess.PIPE)

    def commit(self):
        self.git('-C',str(self.source),'add','.')
        self.git('-C',str(self.source),'-c','user.name=Test','-c','user.email=test@localhost',
                 'commit','--quiet','-m','fixture')

    def run_worker(self, restart=None):
        worker.tick(self.base,self.config,restart=restart or (lambda cfg,v:self.restarts.append(v)))

    def status(self):
        return json.loads((self.base/'status.json').read_text())

    def queue(self):
        (self.base/'inbox/request').write_text(self.status()['revision'])

    def test_install_keeps_previous_module(self):
        self.assertEqual(self.status()['phase'],'available')
        self.queue()
        self.run_worker()
        self.assertEqual(self.restarts,['1.8.0'])
        self.assertEqual((self.live/'VERSION').read_text(),'1.8.0')
        self.assertEqual((self.base/'private/previous/VERSION').read_text(),'1.7.0')
        self.assertEqual(self.status()['phase'],'current')
        self.run_worker()
        self.assertEqual(self.restarts,['1.8.0'])

    def test_unhealthy_release_rolls_back(self):
        self.queue()
        def restart(cfg,v):
            self.restarts.append(v)
            if v=='1.8.0':
                raise RuntimeError('health check failed')
        with self.assertRaises(RuntimeError):
            self.run_worker(restart)
        self.assertEqual(self.restarts,['1.8.0','1.7.0'])
        self.assertEqual(self.status()['phase'],'rolled_back')
        self.assertEqual((self.live/'VERSION').read_text(),'1.7.0')

    def test_changed_revision_needs_new_confirmation(self):
        self.queue()
        (self.tree/'RELEASE.txt').write_text('Changed')
        self.commit()
        with self.assertRaises(ValueError):
            self.run_worker()
        self.assertFalse(self.restarts)
        self.assertEqual((self.live/'VERSION').read_text(),'1.7.0')

    def test_recover_interrupted_restart(self):
        self.queue()
        with self.assertRaises(KeyboardInterrupt):
            self.run_worker(lambda cfg,v: self.interrupt())
        self.run_worker()
        self.assertEqual(self.status()['phase'],'rolled_back')
        self.assertEqual(self.restarts,['1.7.0'])

    @staticmethod
    def interrupt():
        raise KeyboardInterrupt

    def test_admin_queue_contract(self):
        path = Path(__file__).resolve().parents[2]/worker.VERSION_PATH/'staff/module_updates.py'
        deps = ModuleType('api.depends')
        deps.verify_identity_admin = lambda: None
        spec = importlib.util.spec_from_file_location('update_api_fixture', path)
        api = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'api.depends':deps}):
            spec.loader.exec_module(api)
        guarded = [r for r in api.router.routes if not r.path.endswith('/version')]
        self.assertEqual(len(guarded),2)
        for route in guarded:
            self.assertIn(deps.verify_identity_admin,[dep.call for dep in route.dependant.dependencies])
        with patch.object(api,'BASE',self.base):
            body = api.UpdateRequest(revision=self.status()['revision'],restart_confirmed=True)
            request = SimpleNamespace(headers={'content-type':'application/json'})
            with self.assertRaises(api.HTTPException) as csrf:
                api.apply(body,SimpleNamespace(headers={'content-type':'text/plain'}),None)
            self.assertEqual(csrf.exception.status_code,403)
            self.assertEqual(api.apply(body,request,None)['phase'],'queued')
            with self.assertRaises(api.HTTPException) as duplicate:
                api.apply(body,request,None)
            self.assertEqual(duplicate.exception.status_code,409)
            self.assertEqual((self.base/'inbox/request').read_text(),body.revision)
            worker.write_json(self.base/'status.json', dict(phase='recovery_failed', checked=0))
            self.assertEqual(api.snapshot()['phase'],'recovery_failed')
            worker.write_json(self.base/'status.json', dict(phase='available', checked=0))
            self.assertEqual(api.snapshot()['phase'],'offline')
