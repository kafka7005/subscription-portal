"""Scoped operator-capability API for one explicitly approved early renewal.

Grants are minted by a trusted operator in Redis, expire after ten minutes and
bind one UUID, owner, subscription, total and period. No reusable admin login.
Native attempt preparation/submission/fulfilment retain payment idempotency.
"""
import hashlib
import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field


class ManualRequest(BaseModel):
    request_id: UUID
    accepted_amount: Decimal = Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    accepted_period_days: int = Field(ge=1)
    accepted_gross_amount: Decimal | None = Field(None, gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)


def check_grant(grant, body):
    if (not isinstance(grant, dict) or grant.get('request_id') != str(body.request_id)
            or Decimal(str(grant.get('amount', 0))) != body.accepted_amount
            or Decimal(str(grant.get('gross_amount',grant.get('amount',0)))) != (body.accepted_gross_amount or body.accepted_amount)
            or grant.get('period_days') != body.accepted_period_days):
        raise HTTPException(403, 'Операция не соответствует разрешению')


def charge_parts(balance, cost, minimum):
    if balance < 0:
        raise HTTPException(409, 'Сначала пополните отрицательный баланс')
    reserved = min(balance, cost).quantize(Decimal('0.01'))
    charge = cost - reserved
    if 0 < charge < minimum:
        charge = min(cost, minimum)
        reserved = cost - charge
    return reserved, charge


def payment_terms(svc, owner, sub, quote):
    cost = svc.money(quote['amount'])
    if sub.period_days != quote['period_days'] or svc.money(sub.amount) < cost:
        raise HTTPException(409, 'Тариф или сохранённое согласие изменились')
    minimum = Decimal(str(max(.01,float(svc.YOOKASSA_AUTOPAY_CONFIG.get('MIN_PAYMENT_AMOUNT',1)))))
    reserved, charge = charge_parts(Decimal(str(owner.balance or 0)).quantize(Decimal('0.01')),cost,minimum)
    if charge == 0:
        raise HTTPException(409, 'Баланс полностью покрывает продление. Используйте обычное продление с баланса')
    card_quote = svc.quote_yookassa_amount(charge,percent=quote['amount_quote']['fee_percent'])
    total = reserved + card_quote.gross
    consent = svc.money(sub.accepted_gross_amount if sub.accepted_gross_amount is not None else sub.amount)
    if total > consent:
        raise HTTPException(409, 'Итог превышает сохранённое согласие клиента')
    return cost, reserved, charge, card_quote, total


def payment_snapshot(svc, key, card, quote, reserved, gross, total):
    return {'key':svc.checkout_key_snapshot(key),'card_id':card.id,'amount':str(svc.money(quote['amount'])),
            'period_days':quote['period_days'],'expiry_ms':quote['expiry_ms'],
            'reserved':str(reserved),'card_amount':str(gross),'total':str(total)}


async def prepare(grant, body):
    from database import async_session_maker
    from database.access.resolution import UserId
    from database import yookassa_autopay as dal
    from database.users import update_balance
    from services.payments.yookassa_autopay import service as svc

    sid = int(grant['subscription_id'])
    uid = UserId(int(grant['user_id']))
    attempt_id = str(body.request_id)
    async with async_session_maker() as session:
        owner = await dal.get_owner(session, uid, lock=True)
        if owner is None or int(owner.tg_id or 0) != int(grant['telegram_id']):
            raise HTTPException(409, 'Владелец аккаунта изменился')
        prior = await dal.get_attempt(session, attempt_id)
        if prior:
            if prior.user_id != int(uid) or prior.subscription_id != sid or not prior.intent.get('portal_manual'):
                raise HTTPException(409, 'Идентификатор уже использован другой операцией')
            return prior.id
        if not await svc.is_yookassa_autopay_enabled_for_session(session):
            raise HTTPException(409, 'Автоплатежи отключены кассой')
        sub = await dal.get_subscription(session, sid, lock=True)
        if not sub or sub.user_id != int(uid) or not sub.is_active:
            raise HTTPException(409, 'Автопродление не активно или принадлежит другому аккаунту')
        if sub.is_processing or await dal.get_open_subscription_attempt(session, sid):
            raise HTTPException(409, 'У подписки уже есть незавершённая попытка')
        if await dal.get_legacy_pending(session, subscription_id=sid):
            raise HTTPException(409, 'Сначала завершите предыдущий платёж')
        if int(sub.retry_count or 0) >= int(svc.YOOKASSA_AUTOPAY_CONFIG.get('MAX_RETRY_ATTEMPTS',30)):
            raise HTTPException(409, 'Достигнут лимит повторов')
        key = await dal.get_owned_key(session, uid, sub.client_id, lock=True)
        quote = await svc.quote_autopay_for_key(session, uid, sub.client_id)
        cost, reserved, charge, charge_quote, cycle_total = payment_terms(svc,owner,sub,quote)
        approved = body.accepted_amount
        if (cost != approved or quote['period_days'] != body.accepted_period_days
                or sub.period_days != body.accepted_period_days or svc.money(sub.amount) < cost):
            raise HTTPException(409, 'Тариф или сохранённое согласие изменились')
        card = await dal.get_owned_card(session, uid, sub.card_id)
        if card is None:
            raise HTTPException(409, 'Нет сохранённой карты владельца')
        gross = charge_quote.gross
        saved_consent = svc.money(sub.accepted_gross_amount if sub.accepted_gross_amount is not None else sub.amount)
        if cycle_total > (body.accepted_gross_amount or approved) or cycle_total > saved_consent:
            raise HTTPException(409, 'Итоговая сумма превышает подтверждённую')
        if grant.get('expected_snapshot') is not None and grant['expected_snapshot'] != payment_snapshot(svc,key,card,quote,reserved,gross,cycle_total):
            raise HTTPException(409, 'Данные изменились. Откройте предварительный расчёт заново')
        target = max(quote['expiry_ms'],int(datetime.now(UTC).timestamp()*1000)) + quote['period_days']*86400000
        intent = {'kind':'recurring','original_user_id':int(uid),**quote,'cost':quote['amount'],
                  'target_expiry_ms':target,'key_snapshot':svc.checkout_key_snapshot(key),
                  'reserved_balance':float(reserved),'balance_only':charge==0,'portal_manual':True}
        if charge_quote:
            intent[svc.YOOKASSA_AMOUNTS] = charge_quote.metadata()
        payload = await svc._payload(session,owner,gross,attempt_id,card_id=card.id)
        attempt = await dal.prepare_attempt(session,uid,payload=payload,intent=intent,
            attempt_id=attempt_id,idempotency_key=attempt_id,subscription_id=sid)
        if attempt.id != attempt_id:
            raise HTTPException(409, 'Появилась другая попытка. Повторное списание запрещено')
        if reserved and await update_balance(session,uid,-float(reserved)) is None:
            raise HTTPException(409, 'Баланс изменился')
        await dal.append_log(session,uid,'manual_attempt_authorized',
            {'subscription_id':sid,'attempt_id':attempt_id,'approved_total':str(approved),'period_days':body.accepted_period_days})
        if grant.get('admin_identity_id'):
            from database.models import AuditEvent
            session.add(AuditEvent(event_type='admin_user_autopay_requested',channel='api',
                actor_identity_id=grant['admin_identity_id'],actor_tg_id=grant.get('admin_tg_id'),
                entity_type='user',entity_id=str(int(uid)),path_or_handler='admin:manual-autopay',result='requested',
                request_id=attempt_id,metadata_={'reason':grant['reason'],'subscription_id':sid,
                    'attempt_id':attempt_id,'amount':str(cycle_total),'from_balance':str(reserved),
                    'from_card':str(gross),'period_days':body.accepted_period_days}))
        await svc._commit(session)
        return attempt_id


async def attempt_result(attempt_id, user_id, subscription_id):
    from database import async_session_maker
    from database import yookassa_autopay as dal
    from services.payments.yookassa_autopay import service as svc
    async with async_session_maker() as session:
        attempt = await dal.get_attempt(session,str(attempt_id))
        if not attempt or attempt.user_id != int(user_id) or attempt.subscription_id != int(subscription_id) or not attempt.intent.get('portal_manual'):
            raise HTTPException(404,'Попытка не найдена')
        answer = {'attempt_id':attempt.id,'status':attempt.status,'provider_status':None,'cancellation_details':None}
        if attempt.payment_id:
            provider = await svc.client.get_payment(attempt.payment_id)
            if provider.data:
                answer['provider_status'] = provider.data.get('status')
                answer['cancellation_details'] = provider.data.get('cancellation_details')
        return answer


def get_router():
    router = APIRouter(prefix='/api/portal',tags=['Portal operator autopay'])

    @router.post('/autopay/manual')
    async def manual(body: ManualRequest, x_portal_operation_token: str = Header(min_length=32,max_length=128)):
        from core.redis_cache import _get_redis
        from database import async_session_maker
        from database import yookassa_autopay as dal
        from services.payments.yookassa_autopay import service as svc
        redis = await _get_redis()
        if redis is None:
            raise HTTPException(503,'Хранилище разрешений недоступно')
        digest = hashlib.sha256(x_portal_operation_token.encode()).hexdigest()
        raw = await redis.get('portal:manual-autopay-grant:'+digest)
        if raw is None:
            raise HTTPException(403,'Разрешение отсутствует или истекло')
        grant = json.loads(raw)
        check_grant(grant,body)
        try:
            attempt_id = await prepare(grant,body)
        except ValueError as exc:
            raise HTTPException(409,str(exc)) from exc
        result = await svc._submit_attempt(attempt_id)
        async with async_session_maker() as session:
            attempt = await dal.get_attempt(session,attempt_id)
            answer = {'attempt_id':attempt_id,'status':attempt.status,'pipeline_ok':result.ok,
                      'pipeline_error':result.error,'provider_status':None,'cancellation_details':None}
            if attempt.payment_id:
                provider = await svc.client.get_payment(attempt.payment_id)
                if provider.data:
                    answer['provider_status'] = provider.data.get('status')
                    answer['cancellation_details'] = provider.data.get('cancellation_details')
            return answer

    return router
