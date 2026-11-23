"""Expose the native scheduled sender's progress without changing bot files."""
from contextvars import ContextVar
from functools import wraps
from time import monotonic

from fastapi import APIRouter, Depends
from api.depends import verify_identity_admin, get_session
from database.scheduled_broadcasts import list_scheduled_broadcasts
from handlers.admin.sender.scheduled_service import scheduled_broadcast_to_dict
from core.redis_cache import cache_get, cache_set

status_router = APIRouter(prefix="/api/portal/broadcast")
_active = ContextVar("portal_broadcast", default=None)


@status_router.get("/recent")
async def recent(identity=Depends(verify_identity_admin), session=Depends(get_session)):
    jobs = await list_scheduled_broadcasts(session, statuses=None, limit=10, offset=0)
    items = []
    for job in jobs:
        item = scheduled_broadcast_to_dict(job)
        stats = (item.get("stats") or {}).get("stats", {})
        item["stats"] = {k: stats[k] for k in ("success_count", "failed_count") if k in stats}
        item["counts"] = await cache_get(f"portal:broadcast:{job.id}") or {}
        items.append(item)
    return {"items": items}


def install_tracking():
    from database import web_notifications
    from handlers.admin.sender import scheduled_service as native

    if getattr(native.execute_scheduled_broadcast, "_portal_tracking", False):
        return
    execute = native.execute_scheduled_broadcast
    service = native.BroadcastService
    notify = web_notifications.notify_web

    @wraps(execute)
    async def tracked(job, *args, **kwargs):
        state = {"key": f"portal:broadcast:{job.id}", "html": job.text, "counts": {}, "last": 0}
        token = _active.set(state)
        try:
            return await execute(job, *args, **kwargs)
        finally:
            _active.reset(token)

    async def publish(state, force=False):
        if force or monotonic() - state["last"] >= 1:
            state["last"] = monotonic()
            await cache_set(state["key"], state["counts"], 86400 * 7)

    class TrackedService(service):
        async def broadcast(self, messages, **kwargs):
            state = _active.get()
            if state is None:
                return await super().broadcast(messages, **kwargs)
            counts = state["counts"]
            counts.update(audience=len(messages), site_processed=0, site_created=0)
            async def telegram(completed, total, sent, failed, pending):
                counts.update(tg_processed=completed, tg_total=total, tg_sent=sent, tg_failed=failed)
                await publish(state, True)
            await publish(state, True)
            result = await super().broadcast(messages, **kwargs, on_progress=telegram)
            await publish(state, True)
            return result

    @wraps(notify)
    async def tracked_notify(session, **kwargs):
        state = _active.get()
        if not state or kwargs.get("type") != "broadcast":
            return await notify(session, **kwargs)
        kwargs["data"] = {**(kwargs.get("data") or {}), "broadcast_html": state["html"]}
        result = await notify(session, **kwargs)
        state["counts"]["site_processed"] += 1
        state["counts"]["site_created"] += int(result is not None)
        await publish(state)
        return result

    tracked._portal_tracking = True
    native.execute_scheduled_broadcast = tracked
    native.BroadcastService = TrackedService
    web_notifications.notify_web = tracked_notify
