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

    @router.get("/balance-history")
    async def balance_history(request: Request, identity=Depends(verify_identity_token),
                              session: AsyncSession = Depends(get_session),
                              limit: int = Query(20, ge=1, le=50), offset: int = Query(0, ge=0, le=100000)):
        from api.depends import get_request_actor
        from database.models import User
        from database.models.bonuses import DailyBonusClaim as Bonus
        from database.models.payments import Payment
        from database.models.subscription_events import SubscriptionEvent as Event
        from sqlalchemy import Float, case, cast, literal, union_all

        actor = get_request_actor(request)
        uid = getattr(actor, "billing_user_id", None)
        if uid is None:
            uid = await session.scalar(select(User.id).where(User.identity_id == identity.id)
                                       .order_by(User.id).limit(1))
        if uid is None:
            return {"items": [], "has_more": False}

        # A successful invoice or a key's sticker price alone does not prove a wallet debit.
        bonus = select(Bonus.id.label("id"), Bonus.created_at.label("at"),
                       literal("bonus").label("kind"), Bonus.amount.label("amount")).where(
            Bonus.user_id == uid, Bonus.amount > 0)
        topup = select(Payment.id, Payment.created_at,
                       case((Payment.payment_system == "admin", "adjustment"), else_="topup"),
                       Payment.amount).where(
            Payment.user_id == uid, Payment.status == "success", Payment.currency == "RUB",
            (Payment.payment_system == "admin") | ((Payment.metadata_["payment_flow"].as_string() == "balance_topup")
                                                   & (Payment.amount > 0)), Payment.amount != 0)
        events = select(Event.id, Event.created_at,
                        case((Event.event_type == "created", "issued"),
                             (Event.event_type == "addons", "addons"),
                             (Event.price_rub < 0, "tariff_credit"), else_="renewal"),
                        case((Event.event_type == "created", cast(None, Float)), else_=-Event.price_rub)).where(
            Event.user_id == uid, (Event.source.is_(None)) | (Event.source != "backfill"),
            ((Event.event_type == "created") & (Event.price_rub > 0)) |
            ((Event.event_type == "renewed") & (Event.price_rub != 0)) |
            ((Event.event_type == "addons") & (Event.price_rub > 0)))
        activity = union_all(bonus, topup, events).subquery()
        rows = (await session.execute(select(activity).order_by(
            activity.c.at.desc(), activity.c.kind, activity.c.id.desc()).offset(offset).limit(limit + 1))).mappings().all()
        return {"has_more": len(rows) > limit,
                "items": [{"id": f"{row['kind']}-{row['id']}", "created_at": iso(row["at"]),
                           "kind": row["kind"], "amount": row["amount"]} for row in rows[:limit]]}

    return router
