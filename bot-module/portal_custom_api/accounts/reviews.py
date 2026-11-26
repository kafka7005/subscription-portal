"""Moderated customer reviews. Only explicitly approved text reaches the landing page."""
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, StrictBool, StringConstraints
from sqlalchemy import text

from api.depends import get_session, verify_identity_admin, verify_identity_token
from api.ratelimit import enforce_rate_limit
from api.admin_permissions import require_admin_action
from database.identities import ensure_billing_user_for_identity, get_identity_by_id
from database.users import update_balance
from filters.permissions import PERM_USER_BALANCE
from ..site_activity import defer_account_balance
from database.settings import get_setting, set_setting

SETTING = "portal_landing_reviews_enabled"
REWARD_SETTING = "portal_review_reward_rub"
MAX_REWARD = 10000
CREATE_REWARDS = """
CREATE TABLE IF NOT EXISTS portal_review_rewards (
    owner varchar(36) PRIMARY KEY REFERENCES identities(id) ON DELETE CASCADE,
    billing_id bigint NOT NULL UNIQUE,
    review_id varchar(36) NOT NULL,
    amount integer NOT NULL CHECK (amount > 0),
    moderator varchar(36) NOT NULL,
    awarded_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""
Status = Literal["pending", "approved", "hidden"]
CREATE = """
CREATE TABLE IF NOT EXISTS portal_customer_reviews (
    id varchar(36) PRIMARY KEY,
    owner varchar(36) NOT NULL UNIQUE REFERENCES identities(id) ON DELETE CASCADE,
    author varchar(40) NOT NULL,
    body varchar(400) NOT NULL,
    rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
    status varchar(10) NOT NULL CHECK (status IN ('pending','approved','hidden')),
    revision varchar(36) NOT NULL,
    submitted_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP
)
"""
FIELDS = "id, author, body, rating, status, revision, submitted_at"


class Submission(BaseModel):
    author: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=400)]
    rating: int = Field(strict=True, ge=1, le=5)
    consent: StrictBool
    revision: UUID | None = None


class Decision(BaseModel):
    status: Literal["approved", "hidden"]
    revision: UUID


class Reward(BaseModel):
    reward_rub: int = Field(strict=True, ge=0, le=MAX_REWARD)


class Visibility(BaseModel):
    enabled: StrictBool


async def exists(session):
    return (await session.scalar(text("SELECT to_regclass('portal_customer_reviews')"))) is not None


async def ensure_table(session):
    if not await exists(session):
        await session.execute(text("SELECT pg_advisory_xact_lock(583172069)"))
        if not await exists(session):
            await session.execute(text(CREATE))
            await session.execute(text("CREATE INDEX portal_reviews_queue ON portal_customer_reviews(status, submitted_at DESC, id)"))


def changed():
    return HTTPException(409, "Отзыв изменился. Обновите его перед повторной попыткой.")


async def enabled(session):
    return await get_setting(session, SETTING, False) is True


async def reward_amount(session):
    value = await get_setting(session, REWARD_SETTING, 0)
    return value if type(value) is int and 0 <= value <= MAX_REWARD else 0


async def rewards_exist(session):
    return (await session.scalar(text("SELECT to_regclass('portal_review_rewards')"))) is not None


async def award_review(session, actor, owner, review_id):
    amount = await reward_amount(session)
    if not amount:
        return 0
    await require_admin_action(session, actor, PERM_USER_BALANCE)
    if str(actor.id) == owner:
        raise HTTPException(403, "Для одобрения вашего отзыва с наградой нужен другой администратор.")
    if not await rewards_exist(session):
        await session.execute(text("SELECT pg_advisory_xact_lock(583172070)"))
        if not await rewards_exist(session):
            await session.execute(text(CREATE_REWARDS))
    recipient = await get_identity_by_id(session, owner)
    if recipient is None:
        raise changed()
    uid = await ensure_billing_user_for_identity(session, recipient)
    receipt = await session.execute(text("""
        INSERT INTO portal_review_rewards (owner, billing_id, review_id, amount, moderator)
        VALUES (:owner, :uid, :review, :amount, :actor)
        ON CONFLICT DO NOTHING RETURNING amount
    """), dict(owner=owner, uid=int(uid), review=str(review_id), amount=amount, actor=str(actor.id)))
    if receipt.scalar_one_or_none() is None:
        return 0
    if await update_balance(session, uid, amount) is None:
        raise HTTPException(409, "Начисление не подтверждено. Отзыв остался на модерации.")
    defer_account_balance(session, uid)
    return amount


REVIEW_QUEUE = "/admin/site?tab=reviews"
REVIEW_TITLE = "Новый отзыв"
REVIEW_MESSAGE = "Отзыв ждёт модерации."


async def can_review(session, identity):
    from api.depends import resolve_identity_role

    if not identity or not identity.is_admin or await resolve_identity_role(session, identity) != "admin":
        return False
    try:
        await require_admin_action(session, identity)
    except HTTPException as exc:
        if exc.status_code == 403:
            return False
        raise
    return True


async def record_review_notices(session):
    from database.models import Identity, User
    from database.web_notifications import create_notification
    from sqlalchemy import select

    recipients = []
    admins = (await session.scalars(select(Identity).where(Identity.is_admin.is_(True)))).all()
    for admin in admins:
        if not await can_review(session, admin):
            continue
        uid = await session.scalar(select(User.id).where(User.identity_id == admin.id).order_by(User.id).limit(1))
        if uid is None:
            uid = await ensure_billing_user_for_identity(session, admin)
        await create_notification(session, user_id=int(uid), identity_id=admin.id, type="system",
                                  title=REVIEW_TITLE, message=REVIEW_MESSAGE, data={"href": REVIEW_QUEUE})
        recipients.append(admin.id)
    return recipients


async def push_review_notices(recipients, review_id):
    from database import async_session_maker
    from database.web_notifications import get_push_subscriptions_by_identity
    from services.web_push import push_enabled, send_push_to_many
    from logger import logger

    if not push_enabled():
        return
    for recipient in recipients:
        try:
            async with async_session_maker() as session:
                if not await can_review(session, await get_identity_by_id(session, recipient)):
                    continue
                subs = await get_push_subscriptions_by_identity(session, recipient)
                endpoints = [{"endpoint": sub.endpoint, "keys": sub.keys_json} for sub in subs]
            if endpoints:
                await send_push_to_many(endpoints, REVIEW_TITLE, REVIEW_MESSAGE, REVIEW_QUEUE,
                                        tag=f"review-{review_id}")
        except Exception as exc:
            logger.warning("[Site:Reviews] Push delivery failed: {}", type(exc).__name__)


def get_router(prefix):
    router = APIRouter(prefix=prefix + "/reviews", tags=["Customer reviews"])

    @router.get("/public")
    async def published(session=Depends(get_session)):
        if not await enabled(session) or not await exists(session):
            return {"items": []}
        rows = await session.execute(text("""
            SELECT author, body, rating FROM portal_customer_reviews
            WHERE status = 'approved' ORDER BY random() LIMIT 8
        """))
        return {"items": [dict(row) for row in rows.mappings()]}

    @router.get("/mine")
    async def mine(identity=Depends(verify_identity_token), session=Depends(get_session)):
        info = {"reward_rub": await reward_amount(session), "awarded_rub": 0}
        if await rewards_exist(session):
            amount = await session.execute(text("SELECT amount FROM portal_review_rewards WHERE owner=:owner"),
                                           {"owner": str(identity.id)})
            info["awarded_rub"] = amount.scalar_one_or_none() or 0
        if not await exists(session):
            return {**info, "review": None}
        row = (await session.execute(text(f"SELECT {FIELDS} FROM portal_customer_reviews WHERE owner=:owner"),
                                     {"owner": str(identity.id)})).mappings().one_or_none()
        return {**info, "review": dict(row) if row else None}

    @router.put("/mine")
    async def submit(body: Submission, request: Request, background: BackgroundTasks, identity=Depends(verify_identity_token),
                     session=Depends(get_session)):
        if not body.consent:
            raise HTTPException(422, "Подтвердите согласие на публикацию.")
        await enforce_rate_limit(request, session, bucket="portal_review_submit", max_per_window=8, window_sec=60)
        await ensure_table(session)
        if body.revision is not None:
            raise HTTPException(409, "Отправленный отзыв нельзя редактировать.")
        values = dict(id=str(uuid4()), owner=str(identity.id), author=body.author, body=body.body,
                      rating=body.rating, revision=str(uuid4()))
        row = (await session.execute(text(f"""
            INSERT INTO portal_customer_reviews (id, owner, author, body, rating, status, revision)
            VALUES (:id, :owner, :author, :body, :rating, 'pending', :revision)
            ON CONFLICT (owner) DO NOTHING RETURNING {FIELDS}
        """), values)).mappings().one_or_none()
        if row is None:
            raise HTTPException(409, "Вы уже отправили отзыв.")
        recipients = await record_review_notices(session)
        # Publish the review and inbox entries together before any device can follow the push.
        await session.commit()
        if recipients:
            background.add_task(push_review_notices, recipients, values["id"])
        return {"review": dict(row)}

    @router.delete("/admin/{review_id}")
    async def remove(review_id: UUID, revision: UUID, identity=Depends(verify_identity_admin),
                     session=Depends(get_session)):
        if not await exists(session):
            raise changed()
        result = await session.execute(text("DELETE FROM portal_customer_reviews WHERE id=:id AND revision=:rev"),
                                       {"id": str(review_id), "rev": str(revision)})
        if not result.rowcount:
            raise changed()
        return {"ok": True}

    @router.get("/admin")
    async def queue(status: Status = "pending", offset: int = Query(0, ge=0),
                    identity=Depends(verify_identity_admin), session=Depends(get_session)):
        items = []
        if await exists(session):
            rows = await session.execute(text(f"""
                SELECT {FIELDS} FROM portal_customer_reviews WHERE status=:status
                ORDER BY submitted_at DESC, id LIMIT 21 OFFSET :offset
            """), {"status": status, "offset": offset})
            items = [dict(row) for row in rows.mappings()]
        return {"enabled": await enabled(session), "can_delete": True, "reward_rub": await reward_amount(session), "items": items[:20], "has_more": len(items) > 20}

    @router.put("/admin/visibility")
    async def visibility(body: Visibility, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        await set_setting(session, SETTING, body.enabled, "Показывать одобренные отзывы на лендинге")
        return {"enabled": body.enabled}

    @router.put("/admin/reward")
    async def set_reward(body: Reward, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        await require_admin_action(session, identity, PERM_USER_BALANCE)
        await set_setting(session, REWARD_SETTING, body.reward_rub, "Награда за одобренный отзыв в рублях")
        return {"reward_rub": body.reward_rub}

    @router.put("/admin/{review_id}")
    async def moderate(review_id: UUID, body: Decision, identity=Depends(verify_identity_admin),
                       session=Depends(get_session)):
        if not await exists(session):
            raise changed()
        result = await session.execute(text("""
            UPDATE portal_customer_reviews SET status=:status, revision=:next
            WHERE id=:id AND revision=:previous AND status<>:status RETURNING owner
        """), {"status": body.status, "next": str(uuid4()), "id": str(review_id), "previous": str(body.revision)})
        owner = result.scalar_one_or_none()
        if owner is None:
            raise changed()
        awarded = await award_review(session, identity, owner, review_id) if body.status == "approved" else 0
        return {"ok": True, "awarded_rub": awarded}

    return router
