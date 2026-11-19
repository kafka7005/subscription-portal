import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import unittest
from unittest.mock import patch

os.environ['SITE_ORIGIN']='https://portal.example'
spec=importlib.util.spec_from_file_location('gateway',Path(__file__).with_name('api.py'))
api=importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)

class GatewayTests(unittest.TestCase):
    def test_full_admin_only(self):
        self.assertEqual(api.admin_status(''),401)
        with patch.object(api.http.client,'HTTPSConnection') as connect:
            response=connect.return_value.getresponse.return_value
            response.status=200
            for role,expected in [('moderator',403),('designer',403),(None,403),('admin',200)]:
                response.read.return_value=json.dumps({'is_admin':True,'role':role}).encode()
                self.assertEqual(api.admin_status('auth_token=mock'),expected)
            response.status=302
            self.assertEqual(api.admin_status('auth_token=mock'),503)

    def test_auth_and_enqueue(self):
        with tempfile.TemporaryDirectory() as d:
            api.STATE=Path(d)/'status'
            api.REQUEST=Path(d)/'request'
            api.STATE.write_text(json.dumps({'phase':'available','latest':'a'*40}))
            address=str(Path(d)/'socket')
            with api.Server(address,api.Handler) as srv:
                thread=threading.Thread(target=srv.serve_forever)
                thread.start()
                def post(origin,code):
                    with patch.object(api,'admin_status',return_value=code), socket.socket(socket.AF_UNIX) as client:
                        client.connect(address)
                        client.sendall(('POST /_site-update/apply HTTP/1.0\r\nX-Portal-Update: 1\r\nOrigin: '+origin+'\r\n\r\n').encode())
                        return int(client.makefile().readline().split()[1])
                try:
                    self.assertEqual(post(api.ORIGIN,401),401)
                    self.assertEqual(post(api.ORIGIN,403),403)
                    self.assertEqual(post('https://other.example',200),403)
                    self.assertFalse(api.REQUEST.exists())
                    self.assertEqual(post(api.ORIGIN,200),202)
                    self.assertTrue(api.REQUEST.exists())
                finally:
                    srv.shutdown(); thread.join()
