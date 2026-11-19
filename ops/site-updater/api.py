"""Local Unix-socket gateway. Can enqueue one fixed operation; has no deployment credentials."""
import http.client
import json
import os
import re
import socketserver
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

ORIGIN = os.environ['SITE_ORIGIN']
HOST = urlsplit(ORIGIN).hostname
STATE = Path('/var/lib/portal-site-updater/state.json')
REQUEST = Path('/var/lib/portal-site-updater/queue/apply')
SOCKET = Path('/run/portal-site-updater/api.sock')

def admin_status(cookies):
    jar = SimpleCookie()
    jar.load(cookies)
    token = jar.get('auth_token')
    if not token or not re.fullmatch(r'[A-Za-z0-9._~+/=-]{1,4096}', token.value):
        return 401
    # Fixed HTTPS origin. Never relay headers to a redirect destination.
    conn = http.client.HTTPSConnection(HOST, timeout=6)
    try:
        conn.request('GET', '/api/auth/me', headers={'Cookie': 'auth_token='+token.value})
        res = conn.getresponse()
        if res.status in (401, 403):
            return res.status
        if res.status != 200:
            return 503
        user = json.loads(res.read(65536))
        return 200 if user.get('is_admin') is True and user.get('role') == 'admin' else 403
    finally:
        conn.close()

class Handler(BaseHTTPRequestHandler):
    timeout = 8
    def log_message(self, *args):
        pass

    def respond(self, code, payload=None):
        body = json.dumps(payload or {}, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length',str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def handle_update(self, apply=False):
        if self.path != '/_site-update/'+('apply' if apply else 'status'):
            return self.respond(404)
        if apply and (self.headers.get('Origin') != ORIGIN or self.headers.get('X-Portal-Update') != '1'
                      or self.headers.get('Content-Length','0') != '0' or self.headers.get('Transfer-Encoding')):
            return self.respond(403)
        try:
            code = admin_status(self.headers.get('Cookie',''))
            if code != HTTPStatus.OK:
                return self.respond(code)
            data = json.loads(STATE.read_text())
            if apply:
                if data['phase'] not in ('available','failed') or not data.get('latest'):
                    return self.respond(409,data)
                try:
                    REQUEST.touch(mode=0o600,exist_ok=False)
                except FileExistsError:
                    pass
                data['phase']='queued'
            elif REQUEST.exists() and data['phase'] in ('available','failed'):
                data['phase']='queued'
            self.respond(202 if apply else 200,data)
        except (OSError, ValueError, KeyError, http.client.HTTPException):
            self.respond(503)

    def do_GET(self):
        self.handle_update()

    def do_POST(self):
        self.handle_update(True)

class Server(socketserver.ThreadingMixIn,socketserver.UnixStreamServer):
    daemon_threads=True

if __name__ == '__main__':
    SOCKET.unlink(missing_ok=True)
    with Server(str(SOCKET),Handler) as server:
        os.chmod(SOCKET,0o666)
        server.serve_forever()
