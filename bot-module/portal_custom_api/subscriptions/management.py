"""Administrator operations on a single subscription."""
from hashlib import sha256
import json

from api.admin_permissions import require_admin_action
from api.depends import get_session, verify_identity_admin
from api.v2.routes.keys.admin_subs import _renew_apply, _resolve
from database.models import Key
from database.tariffs import get_tariff_by_id
from fastapi import APIRouter, Depends, HTTPException
from filters.permissions import PERM_KEY_DEVICES, PERM_KEY_REISSUE, PERM_KEY_TRAFFIC, PERM_KEY_VIEW
from pydantic import BaseModel, Field
from sqlalchemy import select

from .rotation import rotate_link, notify_owner


class Revision(BaseModel):
    revision: str = Field(min_length=64, max_length=64)


class Rebuild(Revision):
    cluster: str = Field(min_length=1, max_length=255)
    node: str | None = Field(None, max_length=255)


class Limits(Revision):
    base_devices: int = Field(strict=True, ge=0, le=2_147_483_647)
    extra_devices: int = Field(strict=True, ge=0, le=2_147_483_647)
    base_traffic: int = Field(strict=True, ge=0, le=2_147_483_647)
    extra_traffic: int = Field(strict=True, ge=0, le=2_147_483_647)


def signature(*parts):
    return sha256(json.dumps(parts, default=str, sort_keys=True).encode()).hexdigest()


def configuration(key, tariff):
    devices = key.selected_device_limit if key.selected_device_limit is not None else tariff.get('device_limit') or 1
    traffic = key.selected_traffic_limit or 0
    limits = dict(base_devices=devices, extra_devices=max(0, (key.current_device_limit or 0) - devices),
                  base_traffic=traffic, extra_traffic=max(0, (key.current_traffic_limit or 0) - traffic) if traffic else 0)
    return dict(**limits, configurable=bool(tariff.get('configurable')),
                device_options=sorted(set(map(int, tariff.get('device_options') or []))),
                traffic_options=sorted(set(map(int, tariff.get('traffic_options_gb') or []))),
                revision=signature(key.user_id, key.client_id, key.tariff_id, key.expiry_time, key.server_id,
                                   key.selected_device_limit, key.current_device_limit, key.selected_traffic_limit,
                                   key.current_traffic_limit, key.selected_price_rub, tariff))


def link_revision(key):
    return signature(key.user_id, key.client_id, key.server_id, key.email, key.key, key.remnawave_link)


async def locked_key(session, target):
    original = await _resolve(session, target)
    key = await session.scalar(select(Key).where(Key.client_id == target, Key.user_id == original.user_id)
                               .with_for_update().execution_options(populate_existing=True))
    if key is None:
        raise HTTPException(409, 'Подписка изменилась. Откройте карточку заново.')
    return key


def check_revision(given, current):
    if given != current:
        raise HTTPException(409, 'Данные изменились. Закройте окно и откройте его заново.')


def validate_pair(base, extra, previous, options):
    if base != previous and base not in options:
        raise HTTPException(422, 'Базовое значение недоступно для этого тарифа.')
    if base == 0 and extra:
        raise HTTPException(422, 'Для безлимита нельзя указать докупленный объём.')
    if base + extra > 2_147_483_647:
        raise HTTPException(422, 'Суммарный лимит слишком велик.')


def get_router(prefix):
    router = APIRouter(prefix=prefix + '/admin/subscriptions')

    @router.get('/{target}/configuration')
    async def read(target: str, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        await require_admin_action(session, identity, PERM_KEY_VIEW)
        key = await _resolve(session, target)
        tariff = await get_tariff_by_id(session, key.tariff_id) if key.tariff_id else {}
        return {**configuration(key, tariff or {}), 'link_revision': link_revision(key)}

    @router.put('/{target}/configuration')
    async def save(target: str, body: Limits, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        from database.keys import invalidate_key_details

        await require_admin_action(session, identity, PERM_KEY_VIEW)
        key = await locked_key(session, target)
        tariff = await get_tariff_by_id(session, key.tariff_id) if key.tariff_id else {}
        before = configuration(key, tariff or {})
        check_revision(body.revision, before['revision'])
        if not before['configurable']:
            raise HTTPException(409, 'Тариф не поддерживает раздельную настройку.')
        devices_changed = (body.base_devices, body.extra_devices) != (before['base_devices'], before['extra_devices'])
        traffic_changed = (body.base_traffic, body.extra_traffic) != (before['base_traffic'], before['extra_traffic'])
        if not devices_changed and not traffic_changed:
            return before
        if devices_changed:
            await require_admin_action(session, identity, PERM_KEY_DEVICES)
            validate_pair(body.base_devices, body.extra_devices, before['base_devices'], before['device_options'])
        if traffic_changed:
            await require_admin_action(session, identity, PERM_KEY_TRAFFIC)
            validate_pair(body.base_traffic, body.extra_traffic, before['base_traffic'], before['traffic_options'])

        def existing(current, selected, fallback):
            if current is not None:
                return current
            return selected if selected is not None else fallback or 0

        total_devices = body.base_devices + body.extra_devices if devices_changed else existing(
            key.current_device_limit, key.selected_device_limit, tariff.get('device_limit'))
        total_traffic = body.base_traffic + body.extra_traffic if traffic_changed else existing(
            key.current_traffic_limit, key.selected_traffic_limit, tariff.get('traffic_limit'))
        await _renew_apply(session, key, new_expiry=key.expiry_time, total_gb=total_traffic, hwid=total_devices, reset_traffic=False)
        if devices_changed:
            key.selected_device_limit = body.base_devices
            key.current_device_limit = total_devices
        if traffic_changed:
            key.selected_traffic_limit = body.base_traffic or None
            key.current_traffic_limit = total_traffic or None
        key.selected_price_rub = ((tariff.get('price_rub') or 0)
            + max(0, body.base_devices - (tariff.get('device_limit') or 1)) * (tariff.get('device_step_rub') or 0)
            + max(0, body.base_traffic - (tariff.get('traffic_limit') or 0)) * (tariff.get('traffic_step_rub') or 0))
        await session.flush()
        await invalidate_key_details(key.email)
        return configuration(key, tariff)

    @router.get('/{target}/reissue-targets')
    async def targets(target: str, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        from core.bootstrap import MODES_CONFIG
        from database.servers import get_servers
        from settings.config import USE_COUNTRY_SELECTION

        await require_admin_action(session, identity, PERM_KEY_REISSUE)
        await _resolve(session, target)
        servers = await get_servers(session)
        return {'clusters': {name: sorted({s['server_name'] for s in nodes if s.get('server_name')})
                             for name, nodes in servers.items()},
                'select_node': bool(MODES_CONFIG.get('COUNTRY_SELECTION_ENABLED', USE_COUNTRY_SELECTION))}

    @router.post('/{target}/rebuild')
    async def rebuild(target: str, body: Rebuild, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        from api.v2.routes.keys.admin_subs import sub_reissue
        from database import get_tariffs_for_cluster

        await require_admin_action(session, identity, PERM_KEY_REISSUE)
        key = await locked_key(session, target)
        check_revision(body.revision, link_revision(key))
        owner, email = key.user_id, key.email
        choices = await targets(target, identity, session)
        nodes = choices['clusters'].get(body.cluster)
        if not nodes or (choices['select_node'] and body.node not in nodes) or (not choices['select_node'] and body.node):
            raise HTTPException(422, 'Выберите доступный кластер и сервер.')
        if not await get_tariffs_for_cluster(session, body.cluster):
            raise HTTPException(409, 'Для кластера не привязан тариф.')
        await sub_reissue(client_id=target, payload={'cluster': body.node or body.cluster}, identity=identity, session=session)
        current = await session.scalar(select(Key.client_id).where(Key.email == email, Key.user_id == owner))
        return {'client_id': current}

    @router.post('/{target}/rotate-link')
    async def rotate(target: str, body: Revision, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        await require_admin_action(session, identity, PERM_KEY_REISSUE)
        key = await locked_key(session, target)
        check_revision(body.revision, link_revision(key))
        user_id = key.user_id
        link = await rotate_link(session, key)
        await session.commit()
        delivered = await notify_owner(session, user_id, link)
        return {'notified': delivered}

    return router
