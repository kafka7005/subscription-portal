"""Moderated customer reviews. Only explicitly approved text reaches the landing page."""
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, StrictBool, StringConstraints
from sqlalchemy import text

from api.depends import get_session, verify_identity_admin, verify_identity_token
from api.ratelimit import enforce_rate_limit
from database.settings import get_setting, set_setting

SETTING = "portal_landing_reviews_enabled"
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
        if not await exists(session):
            return {"review": None}
        row = (await session.execute(text(f"SELECT {FIELDS} FROM portal_customer_reviews WHERE owner=:owner"),
                                     {"owner": str(identity.id)})).mappings().one_or_none()
        return {"review": dict(row) if row else None}

    @router.put("/mine")
    async def submit(body: Submission, request: Request, identity=Depends(verify_identity_token),
                     session=Depends(get_session)):
        if not body.consent:
            raise HTTPException(422, "Подтвердите согласие на публикацию.")
        await enforce_rate_limit(request, session, bucket="portal_review_submit", max_per_window=8, window_sec=60)
        await ensure_table(session)
        values = dict(owner=str(identity.id), author=body.author, body=body.body,
                      rating=body.rating, revision=str(uuid4()))
        if body.revision is None:
            values["id"] = str(uuid4())
            statement = """INSERT INTO portal_customer_reviews (id, owner, author, body, rating, status, revision)
                VALUES (:id, :owner, :author, :body, :rating, 'pending', :revision)
                ON CONFLICT (owner) DO NOTHING"""
        else:
            values["previous"] = str(body.revision)
            statement = """UPDATE portal_customer_reviews SET author=:author, body=:body, rating=:rating,
                revision=:revision, status='pending', submitted_at=CURRENT_TIMESTAMP
                WHERE owner=:owner AND revision=:previous"""
        row = (await session.execute(text(f"{statement} RETURNING {FIELDS}"), values)).mappings().one_or_none()
        if row is None:
            raise changed()
        return {"review": dict(row)}

    @router.delete("/mine")
    async def withdraw(revision: UUID, identity=Depends(verify_identity_token), session=Depends(get_session)):
        if not await exists(session):
            raise changed()
        result = await session.execute(text("DELETE FROM portal_customer_reviews WHERE owner=:owner AND revision=:rev"),
                                       {"owner": str(identity.id), "rev": str(revision)})
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
        return {"enabled": await enabled(session), "items": items[:20], "has_more": len(items) > 20}

    @router.put("/admin/visibility")
    async def visibility(body: Visibility, identity=Depends(verify_identity_admin), session=Depends(get_session)):
        await set_setting(session, SETTING, body.enabled, "Показывать одобренные отзывы на лендинге")
        return {"enabled": body.enabled}

    @router.put("/admin/{review_id}")
    async def moderate(review_id: UUID, body: Decision, identity=Depends(verify_identity_admin),
                       session=Depends(get_session)):
        if not await exists(session):
            raise changed()
        result = await session.execute(text("""
            UPDATE portal_customer_reviews SET status=:status, revision=:next
            WHERE id=:id AND revision=:previous
        """), {"status": body.status, "next": str(uuid4()), "id": str(review_id), "previous": str(body.revision)})
        if not result.rowcount:
            raise changed()
        return {"ok": True}

    return router
