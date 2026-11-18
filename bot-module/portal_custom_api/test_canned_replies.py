"""Validation, role dependencies and persistence; no real customer messages."""
import importlib.util
import pathlib
import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock
from pydantic import ValidationError

def stub(name,**values):
    parts=name.split('.')
    for i in range(1,len(parts)+1):
        key='.'.join(parts[:i])
        if key not in sys.modules:
            sys.modules[key]=types.ModuleType(key);sys.modules[key].__path__=[]
        if i>1:setattr(sys.modules['.'.join(parts[:i-1])],parts[i-1],sys.modules[key])
    for key,value in values.items():setattr(sys.modules[name],key,value)

stub('api.depends',get_session=lambda:None,verify_identity_admin=lambda:None,verify_identity_agent=lambda:None)
settings=SimpleNamespace(get_setting=AsyncMock(),set_setting=AsyncMock())
audit=AsyncMock()
fallback=AsyncMock(return_value={'items':[{'title':'Default','body':'Default body'}]})
stub('database.settings',get_setting=settings.get_setting,set_setting=settings.set_setting)
stub('audit',safe_record_audit_event=audit)
stub('api.v2.routes.tickets',agent_canned_replies=fallback)
spec=importlib.util.spec_from_file_location('canned_replies',pathlib.Path(__file__).with_name('canned_replies.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class ValidationTests(unittest.TestCase):
    def test_normalizes_and_preserves_multiline_text(self):
        reply=module.Reply(title=' Title ',body=' First\nSecond ')
        self.assertEqual(reply.title,'Title');self.assertEqual(reply.body,'First\nSecond')

    def test_rejects_empty_long_and_duplicate_templates(self):
        for title,body in [(' ','Text'),('Title',' '),('a'*81,'Text'),('Title','b'*2001)]:
            with self.assertRaises(ValidationError):module.Reply(title=title,body=body)
        with self.assertRaises(ValidationError):module.Replies(items=[{'title':'Hi','body':'A'},{'title':'hi','body':'B'}])
        with self.assertRaises(ValidationError):module.Replies(items=[{'title':str(i),'body':'Text'} for i in range(51)])

    def test_empty_list_is_explicitly_allowed(self):
        self.assertEqual(module.Replies(items=[]).model_dump(),{'items':[]})

    def test_agents_read_but_only_full_admin_can_write(self):
        read,save=module.get_router().routes
        self.assertIn(sys.modules['api.depends'].verify_identity_agent,[d.call for d in read.dependant.dependencies])
        self.assertIn(sys.modules['api.depends'].verify_identity_admin,[d.call for d in save.dependant.dependencies])
        self.assertEqual(save.methods,{'PUT'})


class PersistenceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        for mock in [settings.get_setting,settings.set_setting,audit,fallback]:mock.reset_mock()
        self.read,self.save=[r.endpoint for r in module.get_router().routes]
        self.session=SimpleNamespace();self.identity=SimpleNamespace(id='admin',tg_id=123)

    async def test_missing_setting_uses_native_defaults(self):
        settings.get_setting.return_value=None
        result=await self.read(identity=self.identity,session=self.session)
        self.assertEqual(result['items'][0]['title'],'Default');fallback.assert_awaited_once()

    async def test_saved_empty_list_does_not_resurrect_defaults(self):
        settings.get_setting.return_value=[]
        self.assertEqual(await self.read(identity=self.identity,session=self.session),{'items':[]})
        fallback.assert_not_awaited()

    async def test_save_only_writes_dedicated_key_and_audit(self):
        body=module.Replies(items=[{'title':' Hello ','body':' Text '}])
        result=await self.save(body,identity=self.identity,session=self.session)
        self.assertEqual(result,{'items':[{'title':'Hello','body':'Text'}]})
        self.assertEqual(settings.set_setting.call_args.args[1],module.SETTING_KEY)
        self.assertEqual(audit.call_args.kwargs['metadata'],{'count':1})


if __name__=='__main__':unittest.main()
