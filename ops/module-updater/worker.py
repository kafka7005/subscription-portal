"""One-shot systemd worker for the configured module on Linux."""
import ctypes
import fcntl
import io
import json
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path, PurePosixPath

MODULE = 'portal_custom_api'
BASE = Path('/var/lib') / (MODULE + '-updater')
VERSION_PATH = f'bot-module/{MODULE}'
VERSION = re.compile(r'(?:0|[1-9][0-9]{0,5})(?:\.(?:0|[1-9][0-9]{0,5})){2}')
REV = re.compile(r'[0-9a-f]{40}')
HEALTH_PATH = '/api/portal/module-update/version'


def write_json(path, value):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False, mode='w') as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.chmod(out.name, 0o644)
    os.replace(out.name, path)


def version(raw):
    value = raw.strip()
    if not VERSION.fullmatch(value):
        raise ValueError('Invalid module version')
    return value


def triplet(value):
    return tuple(map(int, value.split('.')))


def git(*args):
    return subprocess.check_output(['git', '--git-dir', str(BASE/'private'/'source.git'), *args],
                                   stdin=subprocess.DEVNULL, timeout=75)


def candidate():
    git('fetch', '--quiet', '--no-tags', 'origin', 'refs/heads/main')
    rev = git('rev-parse', 'FETCH_HEAD').decode().strip()
    root = f'{rev}:{VERSION_PATH}'
    notes = git('show', root+'/RELEASE.txt').decode().strip()[:2500]
    return dict(revision=rev, latest=version(git('show', root+'/VERSION').decode()), notes=notes)


def stage(rev, folder, expected):
    # Read regular files from the selected module tree only. No archive links,
    # checkout hooks, or install commands from the fetched project are executed.
    data = git('archive', '--format=tar', rev+':'+VERSION_PATH)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        for entry in archive:
            name = PurePosixPath(entry.name)
            if name.is_absolute() or '..' in name.parts or not name.parts:
                raise ValueError('Invalid path')
            dest = folder/name
            if entry.isdir():
                dest.mkdir(parents=True, exist_ok=True)
            elif entry.isfile() and (name.suffix == '.py' or str(name) in ('VERSION','README.md','RELEASE.txt')):
                content = archive.extractfile(entry).read()
                if name.suffix == '.py':
                    compile(content, entry.name, 'exec')
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(content)
            else:
                raise ValueError('Unsupported module file')
    if version((folder/'VERSION').read_text()) != expected or not all(
            (folder/name).is_file() for name in ('api.py','router.py','__init__.py','staff/module_updates.py')):
        raise ValueError('Incomplete module')


def exchange(left, right):
    # Atomic swap; both directories stay available even if the host stops.
    func = ctypes.CDLL(None, use_errno=True).renameat2
    if func(-100, os.fsencode(left), -100, os.fsencode(right), 2):
        raise OSError(ctypes.get_errno(), 'Directory exchange failed')


def restart_and_verify(config, expected):
    subprocess.run(['systemctl','restart',config['unit']], check=True, timeout=90)
    url = f"http://127.0.0.1:{config['port']}" + HEALTH_PATH
    for _ in range(45):
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if json.load(response).get('version') == expected:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(1)
    raise RuntimeError('Loaded module version was not confirmed')


def tick(base, config, check=candidate, prepare=stage, restart=restart_and_verify):
    live = Path(config['target'])
    if live.name != MODULE or live.is_symlink() or not live.is_dir():
        raise ValueError('Invalid installation')
    slot = base/'private'/'previous'
    journal = base/'private'/'transaction.json'
    request = base/'inbox'/'request'
    status = base/'status.json'
    old = json.loads(status.read_text()) if status.exists() else {}
    current = version((live/'VERSION').read_text())
    def report(phase, **fields):
        write_json(status, {**old, **fields, 'phase':phase, 'current':current, 'checked':int(time.time())})
    def recover():
        nonlocal current
        transaction = json.loads(journal.read_text())
        try:
            if live.stat().st_ino != transaction['inode']:
                if slot.stat().st_ino != transaction['inode']:
                    raise RuntimeError('Previous directory unavailable')
                exchange(live,slot)
            restart(config, transaction['version'])
        except Exception:
            report('recovery_failed')
            raise
        request.unlink(missing_ok=True)
        current = transaction['version']
        report('rolled_back')
        journal.unlink()
    if journal.exists():
        if old.get('phase') != 'recovery_failed':
            recover()
        return
    if not request.exists() and time.time()-old.get('checked',0)<180:
        return
    try:
        info = check()
    except Exception:
        request.unlink(missing_ok=True)
        report('check_failed')
        return
    available = triplet(info['latest']) > triplet(current)
    if not request.exists():
        phase = 'available' if available else 'current'
        if available and old.get('revision') == info['revision'] and old.get('phase') in ('rolled_back','failed'):
            phase = old['phase']
        report(phase, **info)
        return
    try:
        fd = os.open(request, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd) as stream:
            if not stat.S_ISREG(os.fstat(fd).st_mode):
                raise ValueError('Invalid request')
            revision = stream.read(42).strip()
        if not available or info['revision'] != revision or not REV.fullmatch(revision):
            raise ValueError('Preview changed')
        report('installing', **info)
        if live.stat().st_dev != base.stat().st_dev:
            raise ValueError('Stage must share filesystem with module')
        if slot.exists():
            shutil.rmtree(slot)
        slot.mkdir(mode=0o755)
        prepare(revision, slot, info['latest'])
        write_json(journal, dict(inode=live.stat().st_ino, version=current))
        exchange(live,slot)
        restart(config, info['latest'])
        current = info['latest']
        request.unlink()
        report('current', **info)
        journal.unlink()
    except Exception:
        if journal.exists():
            recover()
        else:
            request.unlink(missing_ok=True)
            report('failed', **info)
        raise


if __name__ == '__main__':
    with (BASE/'worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        tick(BASE, json.loads((BASE/'config.json').read_text()))
