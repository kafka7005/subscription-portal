"""Administrator-only update queue. The worker owns installation and restart."""
import json
import os
import tempfile
import time
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from api.depends import verify_identity_admin

BASE = Path('/var/lib/portal_custom_api-updater')
LOADED = (Path(__file__).resolve().parents[1]/'VERSION').read_text().strip()
router = APIRouter(prefix='/api/portal/module-update')


class UpdateRequest(BaseModel):
    revision: str = Field(pattern=r'^[0-9a-f]{40}$')
    restart_confirmed: Literal[True]


def snapshot():
    try:
        data = json.loads((BASE/'status.json').read_text())
        if time.time() - data['checked'] > 420:
            data['phase'] = 'offline'
        elif data['phase'] not in ('installing','recovery_failed') and (BASE/'inbox'/'request').exists():
            data['phase'] = 'queued'
        return {**data, 'current': LOADED}
    except (OSError, ValueError, KeyError):
        return {'phase':'offline','current':LOADED}


@router.get('/version')
def loaded_version():
    return {'version':LOADED}


@router.get('/status')
def status(identity=Depends(verify_identity_admin)):
    return snapshot()


@router.post('/apply', status_code=202)
def apply(body: UpdateRequest, request: Request, identity=Depends(verify_identity_admin)):
    if request.headers.get('content-type','').split(';')[0].strip() != 'application/json' or request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Запрос должен исходить из админки')
    data = snapshot()
    if data['phase'] not in ('available','failed','rolled_back') or data.get('revision') != body.revision or data.get('latest') == LOADED:
        raise HTTPException(409, 'Версия или состояние изменились. Обновите сведения.')
    inbox = BASE/'inbox'
    try:
        with tempfile.NamedTemporaryFile(mode='w', dir=inbox) as tmp:
            tmp.write(body.revision)
            tmp.flush()
            os.fsync(tmp.fileno())
            os.link(tmp.name, inbox/'request')
    except FileExistsError:
        raise HTTPException(409, 'Установка уже поставлена в очередь')
    except OSError:
        raise HTTPException(503, 'Служба обновления недоступна')
    return {**data, 'phase':'queued'}
