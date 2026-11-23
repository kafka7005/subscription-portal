"""Admin-cookie preview/confirm/status interface to the module's native pipeline."""
import json
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.depends import get_session, verify_identity_admin
from .manual_autopay import ManualRequest, attempt_result, payment_snapshot, payment_terms, prepare


class ConfirmRequest(BaseModel):
    preview_id: UUID
    confirmed: bool = False
    reason: str = Field(min_length=3,max_length=500)


def validate_preview(grant, user_id, subscription_id, identity_id):
    if (not grant or grant.get('user_id') != user_id or grant.get('subscription_id') != subscription_id
            or grant.get('admin_identity_id') != str(identity_id)):
        raise HTTPException(409,'Предварительный расчёт истёк или относится к другой операции')


async def require_permission(session, identity):
    from api.admin_permissions import require_admin_action
    from filters.permissions import PERM_USER_BALANCE
    await require_admin_action(session,identity,PERM_USER_BALANCE)


def get_router():
    router = APIRouter(prefix='/api/portal/admin/users',tags=['Portal admin manual autopay'])

    @router.post('/{user_id}/autopay/{subscription_id}/preview')
    async def preview(user_id:int=Path(gt=0),subscription_id:int=Path(gt=0),
                      identity=Depends(verify_identity_admin),session:AsyncSession=Depends(get_session)):
        from core.redis_cache import _get_redis
        from database import yookassa_autopay as dal
        from database.access.resolution import UserId
        from services.payments.yookassa_autopay import service as svc
        await require_permission(session,identity)
        if not await svc.is_yookassa_autopay_enabled_for_session(session):
            raise HTTPException(409,'Автоплатежи отключены кассой')
        sub = await dal.get_subscription(session,subscription_id)
        if not sub or sub.user_id != user_id or not sub.is_active:
            raise HTTPException(404,'Активное автопродление клиента не найдено')
        if sub.is_processing or await dal.get_open_subscription_attempt(session,sub.id):
            raise HTTPException(409,'У подписки есть незавершённая попытка')
        if await dal.get_legacy_pending(session,subscription_id=sub.id):
            raise HTTPException(409,'Сначала завершите предыдущий платёж')
        if int(sub.retry_count or 0) >= int(svc.YOOKASSA_AUTOPAY_CONFIG.get('MAX_RETRY_ATTEMPTS',30)):
            raise HTTPException(409,'Достигнут лимит повторов')
        uid=UserId(user_id)
        try:
            owner=await dal.get_owner(session,uid)
            key=await dal.get_owned_key(session,uid,sub.client_id)
            card=await dal.get_owned_card(session,uid,sub.card_id)
            quote=await svc.quote_autopay_for_key(session,uid,sub.client_id)
            cost,reserved,charge,card_quote,total=payment_terms(svc,owner,sub,quote)
        except ValueError as exc:
            raise HTTPException(409,str(exc)) from exc
        if not card:
            raise HTTPException(409,'Нет сохранённой карты клиента')
        preview_id=str(uuid4())
        grant={'user_id':user_id,'telegram_id':int(owner.tg_id or 0),'subscription_id':sub.id,
               'amount':str(cost),'gross_amount':str(total),'period_days':quote['period_days'],
               'request_id':preview_id,'admin_identity_id':str(identity.id),
               'admin_tg_id':getattr(identity,'tg_id',None),
               'expected_snapshot':payment_snapshot(svc,key,card,quote,reserved,card_quote.gross,total)}
        redis=await _get_redis()
        if redis is None:raise HTTPException(503,'Хранилище расчётов недоступно')
        await redis.set(f'portal:admin-autopay-preview:{identity.id}:{preview_id}',json.dumps(grant),ex=600)
        expiry_after=max(quote['expiry_ms'],int(datetime.now(UTC).timestamp()*1000))+quote['period_days']*86400000
        return {'preview_id':preview_id,'amount':str(cost),'gross_amount':str(total),
                'from_balance':str(reserved),'from_card':str(card_quote.gross),
                'period_days':quote['period_days'],'expiry_before':quote['expiry_ms'],'expiry_after':expiry_after,
                'card_mask':card.card_mask,'client_id':sub.client_id,
                'valid_until':(datetime.now(UTC)+timedelta(minutes=10)).isoformat()}

    @router.post('/{user_id}/autopay/{subscription_id}/charge')
    async def charge(body:ConfirmRequest,user_id:int=Path(gt=0),subscription_id:int=Path(gt=0),
                     identity=Depends(verify_identity_admin),session:AsyncSession=Depends(get_session)):
        from core.redis_cache import _get_redis
        from services.payments.yookassa_autopay import service as svc
        await require_permission(session,identity)
        if not body.confirmed or len(body.reason.strip()) < 3:raise HTTPException(422,'Подтвердите списание и укажите причину')
        redis=await _get_redis()
        if redis is None:raise HTTPException(503,'Хранилище расчётов недоступно')
        raw=await redis.get(f'portal:admin-autopay-preview:{identity.id}:{body.preview_id}')
        grant=json.loads(raw) if raw else None
        validate_preview(grant,user_id,subscription_id,identity.id)
        # Keep the confirmed reason stable across retries, like the payment UUID.
        reason_key=f'portal:admin-autopay-reason:{identity.id}:{body.preview_id}'
        await redis.set(reason_key,body.reason.strip(),nx=True,ex=600)
        saved=await redis.get(reason_key)
        if isinstance(saved,bytes):saved=saved.decode()
        if saved != body.reason.strip():raise HTTPException(409,'Причина уже подтверждена. Повторите исходный запрос')
        grant['reason']=saved
        request=ManualRequest(request_id=body.preview_id,accepted_amount=grant['amount'],
                              accepted_gross_amount=grant['gross_amount'],accepted_period_days=grant['period_days'])
        # Native admin authentication locks its billing user/identity. Release
        # those locks before the payment pipeline opens an independent session,
        # particularly when an administrator charges their own subscription.
        await session.commit()
        try:attempt_id=await prepare(grant,request)
        except ValueError as exc:raise HTTPException(409,str(exc)) from exc
        result=await svc._submit_attempt(attempt_id)
        answer=await attempt_result(attempt_id,user_id,subscription_id)
        return {**answer,'pipeline_ok':result.ok,'pipeline_error':result.error}

    @router.get('/{user_id}/autopay/{subscription_id}/attempts/{attempt_id}')
    async def status(attempt_id:UUID,user_id:int=Path(gt=0),subscription_id:int=Path(gt=0),
                     identity=Depends(verify_identity_admin),session:AsyncSession=Depends(get_session)):
        await require_permission(session,identity)
        return await attempt_result(str(attempt_id),user_id,subscription_id)

    return router
