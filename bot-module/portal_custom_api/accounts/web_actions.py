"""Optional site actions. Existing bot services own all financial writes."""
import json
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from api.depends import get_session, verify_identity_token


class TransferBody(BaseModel):
    amount_rub: Decimal = Field(gt=0, max_digits=12, decimal_places=2, allow_inf_nan=False)
    request_id: UUID


def transfer_options():
    from api.v2.routes.root import _partner_feature_enabled
    from modules.partner_program import settings
    return {
        "enabled": bool(_partner_feature_enabled() and settings.ENABLE_WITHDRAW_TO_BALANCE),
        "custom_amount_enabled": bool(settings.ENABLE_CUSTOM_WITHDRAW_AMOUNT),
        "min_amount_rub": 0 if settings.SKIP_PAYOUT_LIMIT_FOR_BALANCE else float(settings.MIN_PARTNER_PAYOUT),
    }


async def completed_transfer(session, owner, operation):
    from database.models import AuditEvent
    from sqlalchemy import select

    return await session.scalar(select(AuditEvent.metadata_).where(
        AuditEvent.event_type == 'partner_transfer_completed',
        AuditEvent.entity_id == str(owner), AuditEvent.request_id == str(operation)
    ).limit(1))


def record_transfer(session, owner, operation, amount):
    from database.models import AuditEvent

    session.add(AuditEvent(event_type='partner_transfer_completed', channel='api',
        entity_type='user', entity_id=str(owner), request_id=str(operation),
        path_or_handler='partner:transfer', result='success', metadata_={'amount': str(amount)}))


def confirmed(amount):
    return {'ok': True, 'amount_rub': float(amount), 'message': 'Средства переведены на баланс'}


def get_router():
    router = APIRouter(prefix="/api/portal", tags=["Portal site actions"])

    @router.get("/partner-transfer/options")
    async def options(identity=Depends(verify_identity_token)):
        return transfer_options()

    @router.get("/partner-transfer/{operation}")
    async def transfer_status(operation: UUID, request: Request, identity=Depends(verify_identity_token),
                              session: AsyncSession = Depends(get_session)):
        from api.v2.routes.partners import _resolve_partner_user
        owner, _ = await _resolve_partner_user(session, request, identity)
        saved = await completed_transfer(session, owner, operation)
        if saved:
            return {'state':'done', **confirmed(saved['amount'])}
        from core.redis_cache import _get_redis
        redis = await _get_redis()
        if redis is None:
            return {'state':'unconfirmed'}
        raw = await redis.get(f'portal:partner-transfer:{owner}:{operation}')
        if raw is None:
            return {'state':'not_found'}
        prior = json.loads(raw)
        if prior.get('state') == 'done':
            return {'state':'done', **prior['result']}
        return {'state':'unconfirmed'}

    @router.post("/partner-transfer")
    async def transfer(body: TransferBody, request: Request,
                       identity=Depends(verify_identity_token),
                       session: AsyncSession = Depends(get_session)):
        from api.v2.routes.partners import _resolve_partner_user
        from core.redis_cache import _get_redis
        from database import partners as pdb
        from modules.partner_program.handlers.payments import move_partner_to_main
        from api.ratelimit import enforce_rate_limit

        cfg = transfer_options()
        if not cfg["enabled"]:
            raise HTTPException(403, "Перевод на баланс отключён в настройках бота")
        await enforce_rate_limit(request, session, bucket="portal_partner_transfer", max_per_window=10, window_sec=60)
        uid, _ = await _resolve_partner_user(session, request, identity)
        saved = await completed_transfer(session, uid, body.request_id)
        if saved is not None:
            if Decimal(saved['amount']) != body.amount_rub:
                raise HTTPException(409, "Номер операции уже использован для другой суммы")
            return confirmed(saved['amount'])
        redis = await _get_redis()
        if redis is None:
            raise HTTPException(503, "Защита платежей недоступна. Попробуйте позже")
        receipt = f"portal:partner-transfer:{uid}:{body.request_id}"
        amount = body.amount_rub
        # Claim before money movement. Ambiguous outcomes stay blocked rather
        # than risking another debit after a timeout or process interruption.
        claimed = await redis.set(receipt, json.dumps({"state": "pending", "amount": str(amount)}), nx=True, ex=604800)
        if not claimed:
            prior = json.loads(await redis.get(receipt) or '{}')
            if prior.get("amount") != str(amount):
                raise HTTPException(409, "Номер операции уже использован для другой суммы")
            if prior.get("state") == "done":
                return prior["result"]
            raise HTTPException(409, "Операция уже принята. Обновите баланс перед повторной попыткой")
        started = False
        try:
            profile = await pdb.get_partner_profile(session, uid, lock=True)
            if profile is None or profile.get("tg_id") is None:
                raise HTTPException(409, "Для перевода требуется связанный Telegram-профиль")
            balance = Decimal(str(profile["partner_balance"] or 0))
            if not cfg["custom_amount_enabled"] and amount != balance:
                raise HTTPException(400, "Доступен только перевод всего партнёрского баланса")
            if amount > balance or amount < Decimal(str(cfg["min_amount_rub"])):
                raise HTTPException(400, "Сумма превышает баланс или ниже допустимого минимума")
            # The native service commits this receipt with the two balance changes.
            record_transfer(session, uid, body.request_id, amount)
            started = True
            # Locks the same user, debits partner balance, credits main balance,
            # records approved payout, commits and invalidates the bot cache.
            await move_partner_to_main(session, int(profile["tg_id"]), float(amount))
            result = confirmed(amount)
            await redis.set(receipt, json.dumps({"state": "done", "amount": str(amount), "result": result}), ex=604800)
            return result
        except (HTTPException, ValueError) as exc:
            await session.rollback()
            if not started:
                await redis.delete(receipt)
            if isinstance(exc, ValueError):
                raise HTTPException(400, str(exc)) from exc
            raise
        except Exception as exc:
            await session.rollback()
            if not started:
                await redis.delete(receipt)
            raise HTTPException(503, "Не удалось подтвердить результат. Обновите баланс; не повторяйте перевод вслепую") from exc

    return router
