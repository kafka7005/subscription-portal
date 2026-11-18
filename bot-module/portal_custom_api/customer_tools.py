"""Read-only history of owned autopay attempts. No provider calls or card details."""
from datetime import timezone

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from api.depends import get_session, verify_identity_token


def iso(value):
    if value is None:
        return None
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def attempt_scope(model, owner):
    return [model.user_id == owner, model.subscription_id.is_not(None)]


def get_router():
    router = APIRouter(prefix="/api/portal", tags=["Portal customer tools"])

    @router.get("/autopay-history")
    async def history(request: Request, identity=Depends(verify_identity_token),
                      session: AsyncSession = Depends(get_session),
                      limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=100000)):
        from api.shared.billing_actor import resolve_billing_user_id
        from database.models.yookassa_autopay import YooKassaAutopayAttempt as Attempt, YooKassaSubscription as Sub
        uid = await resolve_billing_user_id(request, identity, session)
        # Owner-scoped at query level, including legacy/deleted subscriptions.
        scope = attempt_scope(Attempt, uid)
        total = await session.scalar(select(func.count()).select_from(Attempt).where(*scope))
        pairs = (await session.execute(select(Attempt, Sub).outerjoin(Sub,
            (Sub.id == Attempt.subscription_id) & (Sub.user_id == uid)).where(*scope)
            .order_by(Attempt.created_at.desc(), Attempt.id.desc()).limit(limit).offset(offset))).all()
        items = []
        for attempt, sub in pairs:
            amount = (attempt.payload or {}).get("amount", {}).get("value")
            try:
                amount = float(amount) if amount is not None else None
            except (ValueError, TypeError):
                amount = None
            items.append({"id": attempt.id, "client_id": sub.client_id if sub else None,
                "status": attempt.status, "amount": amount, "created_at": iso(attempt.created_at),
                "updated_at": iso(attempt.updated_at),
                "next_payment_date": iso(sub.next_payment_date) if sub and sub.is_active else None,
                "retry_count": sub.retry_count if sub else None,
                "reason": "Причина отказа не сохранена в журнале бота" if attempt.status == "canceled" else None})
        return {"items": items, "total": int(total or 0)}

    return router
