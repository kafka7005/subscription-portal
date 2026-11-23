"""Confirmable admin actions delegated to native handlers; no schema changes."""
from decimal import Decimal
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from api.depends import get_session, verify_identity_admin


class Operation(BaseModel):
    preview: bool = True
    amount: Decimal | None = Field(None, max_digits=12, decimal_places=2, allow_inf_nan=False)
    tariff_id: int | None = Field(None, gt=0)
    reason: str = Field('', max_length=500)
    expected: dict | None = None
    request_id: UUID | None = None


def money(value):
    return Decimal(str(value or 0)).quantize(Decimal('0.01'))


def validate_confirmation(body, current):
    if not body.reason.strip() or body.request_id is None:
        raise HTTPException(422, 'Укажите причину и идентификатор операции')
    if body.expected != current:
        raise HTTPException(409, 'Данные изменились. Повторите предварительный расчёт')


def get_router():
    router = APIRouter(prefix='/api/portal/admin-operations', tags=['Portal admin operations'])

    @router.post('/{kind}/{target}')
    async def operation(kind: Literal['balance', 'tariff'], target: str, body: Operation,
                        identity=Depends(verify_identity_admin), session: AsyncSession = Depends(get_session)):
        from api.admin_permissions import require_admin_action
        from database.models import AuditEvent, User, Key
        from filters.permissions import PERM_USER_BALANCE, PERM_KEY_TARIFF
        from api.v2.routes.keys.admin_subs import _resolve, sub_change_tariff
        from database.tariffs import get_tariff_by_id

        await require_admin_action(session, identity, PERM_USER_BALANCE if kind == 'balance' else PERM_KEY_TARIFF)
        if kind == 'balance':
            if not target.isdigit() or len(target) > 18 or int(target) < 1:
                raise HTTPException(422, 'Некорректный ID клиента')
            user = await session.scalar(select(User).where(User.id == int(target)).with_for_update().execution_options(populate_existing=True))
            if user is None:
                raise HTTPException(404, 'Клиент не найден')
            if body.amount is None or body.amount == 0:
                raise HTTPException(422, 'Сумма должна отличаться от нуля')
            before = {'balance': str(money(user.balance))}
            after = {'balance': str(money(user.balance) + body.amount)}
            user_id = user.id
        else:
            key = await _resolve(session, target)
            key = await session.scalar(select(Key).where(Key.user_id == key.user_id, Key.client_id == key.client_id).with_for_update().execution_options(populate_existing=True))
            old = await get_tariff_by_id(session, key.tariff_id) if key.tariff_id else None
            tariff = await get_tariff_by_id(session, body.tariff_id) if body.tariff_id else None
            if not tariff:
                raise HTTPException(404, 'Тариф не найден')
            before = {'tariff_id': key.tariff_id, 'tariff_name': old.get('name') if old else None,
                      'expiry_time': key.expiry_time,
                      'devices': key.current_device_limit if key.current_device_limit is not None else (old or {}).get('device_limit'),
                      'traffic_gb': key.selected_traffic_limit if key.selected_traffic_limit is not None else (old or {}).get('traffic_limit')}
            after = {'tariff_id': body.tariff_id, 'tariff_name': tariff.get('name'),
                     'expiry_time': key.expiry_time, 'devices': tariff.get('device_limit'),
                     'traffic_gb': tariff.get('traffic_limit')}
            user_id = key.user_id

        fingerprint = {'kind': kind, 'target': target, 'amount': str(body.amount) if kind == 'balance' else None,
                       'tariff_id': body.tariff_id if kind == 'tariff' else None, 'reason': body.reason.strip()}
        # Row lock serializes retries. Receipt and native balance write commit together.
        if not body.preview and body.request_id:
            receipt = await session.scalar(select(AuditEvent).where(
                AuditEvent.request_id == str(body.request_id),
                AuditEvent.event_type == 'admin_user_operation_confirmed',
                AuditEvent.actor_identity_id == str(identity.id)))
            if receipt:
                saved = receipt.metadata_ or {}
                if saved.get('fingerprint') != fingerprint:
                    raise HTTPException(409, 'Идентификатор уже использован для другой операции')
                return saved['response']

        if kind == 'balance' and Decimal(after['balance']) < 0:
            raise HTTPException(409, 'Недостаточно средств для списания')
        if body.preview:
            return {'before': before, 'after': after, 'expected': before}
        validate_confirmation(body, before)
        if kind == 'balance':
            from api.v2.routes.users import adjust_user_balance
            from api.v2.schemas.user_management import UserBalanceRequest
            result = await adjust_user_balance(body=UserBalanceRequest(amount=body.amount),
                user_ref=user_id, identity=identity, session=session)
        else:
            result = await sub_change_tariff(client_id=target, payload={'tariff_id': body.tariff_id}, identity=identity, session=session)
        session.add(AuditEvent(event_type='admin_user_operation_confirmed', channel='api',
            actor_identity_id=identity.id, actor_tg_id=getattr(identity,'tg_id',None),
            entity_type='user', entity_id=str(user_id), path_or_handler=f'admin:{kind}', result='success',
            request_id=str(body.request_id), metadata_={'reason': body.reason.strip(), 'before':before,
                'after':after, 'fingerprint':fingerprint, 'response':result}))
        await session.flush()
        return result

    return router
