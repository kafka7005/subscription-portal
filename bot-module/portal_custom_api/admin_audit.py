"""Read-only, admin-only view of existing persisted administrative events."""
from datetime import timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.depends import get_session, verify_identity_admin


def audit_filters(model, *, actor=None, user_id=None, channel=None, result=None):
    filters = [or_(model.event_type.startswith("admin_", autoescape=True),
                   model.event_type == "web_admin_action")]
    if actor:
        conditions = [model.actor_identity_id == actor]
        if actor.lstrip("-").isdigit() and len(actor.lstrip("-")) <= 18:
            conditions.append(model.actor_tg_id == int(actor))
        filters.append(or_(*conditions))
    if user_id is not None:
        filters.extend([model.entity_type == "user", model.entity_id == str(user_id)])
    if channel:
        filters.append(model.channel == channel)
    if result:
        filters.append(model.result == result)
    return filters


def get_router():
    router = APIRouter(prefix="/api/portal", tags=["Portal admin audit"])

    @router.get("/admin-audit")
    async def history(
        identity=Depends(verify_identity_admin),
        session: AsyncSession = Depends(get_session),
        actor: str | None = Query(None, max_length=64),
        user_id: int | None = Query(None, ge=1),
        channel: Literal["api", "telegram"] | None = None,
        result: Literal["success", "error", "failed", "denied", "requested"] | None = None,
        limit: int = Query(40, ge=1, le=100),
        offset: int = Query(0, ge=0, le=100000),
    ):
        from database.models import AuditEvent
        from services.user_audit import EVENT_TYPE_LABELS, _redact_metadata, _safe_path

        filters = audit_filters(AuditEvent, actor=actor, user_id=user_id,
                                channel=channel, result=result)
        total = await session.scalar(select(func.count()).select_from(AuditEvent).where(*filters))
        rows = (await session.execute(select(AuditEvent).where(*filters)
                .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
                .limit(limit).offset(offset))).scalars().all()
        items = []
        for row in rows:
            created = row.created_at
            if created is not None and created.tzinfo is None:
                created = created.replace(tzinfo=timezone.utc)
            action = _safe_path(row.path_or_handler or "")
            items.append({
                "id": row.id, "event_type": row.event_type,
                "label": {'admin_user_operation_confirmed':'Изменение с подтверждением и причиной','admin_user_autopay_requested':'Запрошен ручной автоплатёж','admin_canned_replies_updated':'Обновлены быстрые ответы поддержки','admin_support_reminders_updated':'Изменены напоминания поддержки'}.get(row.event_type, EVENT_TYPE_LABELS.get(row.event_type, action or row.event_type)),
                "action": action, "channel": row.channel,
                "actor_identity_id": row.actor_identity_id, "actor_tg_id": row.actor_tg_id,
                "entity_type": row.entity_type, "entity_id": row.entity_id,
                "result": row.result, "metadata": _redact_metadata(row.metadata_),
                "created_at": created.isoformat() if created else None,
            })
        return {"items": items, "total": int(total or 0), "limit": limit, "offset": offset}

    return router
