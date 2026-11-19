"""Scheduled version check and a serialized, operator-configured installation on demand."""
import json
import os
from pathlib import Path
import re
import subprocess
import time

SOURCE = Path(os.environ['SOURCE_DIR'])
ROOT = Path(os.environ['SITE_ROOT'])
BASE = Path('/var/lib/portal-site-updater')
REQUEST = BASE/'queue/apply'
STATE = BASE/'state.json'
STAMP = 'portal-version.txt'
APPLY = os.environ.get('UPDATE_COMMAND')
SHA = re.compile(r'[0-9a-f]{40}')

def installed():
    try:
        value = (ROOT/STAMP).read_text().strip()
        return value if SHA.fullmatch(value) else None
    except OSError:
        return None

def git(*args):
    return subprocess.check_output(['git','-C',str(SOURCE),*args],timeout=40,encoding='utf-8').strip()

NOTES_FILE = 'docs/release-notes.json'

def notes_at(version):
    if not SHA.fullmatch(version or ''):
        raise ValueError('Unknown version')
    if not git('ls-tree', version, '--', NOTES_FILE):
        return []
    blob = f'{version}:{NOTES_FILE}'
    if int(git('cat-file', '-s', blob)) > 524288:
        raise ValueError('Release notes are too large')
    entries = json.loads(git('show', blob))
    if not isinstance(entries, list):
        raise ValueError('Expected release list')
    seen = set()
    for entry in entries:
        if not isinstance(entry, dict) or not all(isinstance(entry.get(k), str) and entry[k] for k in ('id','title')):
            raise ValueError('Invalid release')
        if entry['id'] in seen:
            raise ValueError('Duplicate release')
        seen.add(entry['id'])
        for key in ('changes','verify'):
            if not isinstance(entry.get(key), list) or not all(isinstance(s,str) for s in entry[key]):
                raise ValueError('Invalid release details')
    return entries

def release_notes(current, latest):
    try:
        entries = notes_at(latest)
        if current == latest:
            return {'scope':'installed', 'items':entries[:1]}
        try:
            previous = {entry['id'] for entry in notes_at(current)}
        except (ValueError, OSError, subprocess.SubprocessError):
            return {'scope':'latest', 'items':entries[:1]}
        return {'scope':'pending', 'items':[e for e in entries if e['id'] not in previous]}
    except (ValueError, OSError, subprocess.SubprocessError):
        return {'scope':'unavailable', 'items':[]}

def write(phase, latest, checked):
    new = STATE.with_suffix('.tmp')
    current = installed()
    new.write_text(json.dumps(dict(phase=phase, current=current, latest=latest, checked=checked,
                                   notes=release_notes(current, latest))))
    new.chmod(0o644)
    new.replace(STATE)

def run():
    previous = None
    try:
        previous=json.loads(STATE.read_text())
    except (OSError, ValueError):
        pass
    failed = previous.get('latest') if previous and previous.get('phase') in ('installing','failed') else None
    while True:
        latest=None
        checked=int(time.time())
        try:
            remote=git('config','--get','branch.'+git('symbolic-ref','--short','HEAD')+'.remote')
            git('fetch','--quiet',remote)
            latest=git('rev-parse','@{upstream}')
            if not SHA.fullmatch(latest):
                raise ValueError('Invalid upstream version')
            phase='current' if installed()==latest else 'failed' if failed==latest else 'available'
        except (subprocess.SubprocessError,OSError,ValueError):
            phase='check_failed'
        write(phase,latest,checked)
        previous_current=installed()
        until=time.monotonic()+180
        while time.monotonic()<until:
            if REQUEST.exists():
                if phase in ('available','failed') and latest != installed():
                    write('installing',latest,checked)
                    REQUEST.unlink(missing_ok=True)
                    try:
                        command=[APPLY] if APPLY else ['bash',str(SOURCE/'scripts/update.sh'),'--web-root',str(ROOT)]
                        # systemd stops the whole cgroup if the worker is interrupted.
                        subprocess.run(command,check=True,cwd=SOURCE,stdin=subprocess.DEVNULL)
                        if not installed():
                            raise ValueError('Missing deployment receipt')
                        failed=None
                    except (OSError, ValueError, subprocess.SubprocessError):
                        failed=latest
                        write('failed',latest,checked)
                else:
                    REQUEST.unlink(missing_ok=True)
                break
            if installed()!=previous_current:
                break
            time.sleep(1)

if __name__ == '__main__':
    run()
