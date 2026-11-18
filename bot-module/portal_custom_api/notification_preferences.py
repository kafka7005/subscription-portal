"""Optional in-memory adapters; no native bot files or Telegram delivery change."""
from contextvars import ContextVar
from functools import wraps

_context = ContextVar("portal_notification_context", default=None)


def preference_key(kind):
    if kind == "ticket":
        return "portal_push_support"
    if kind == "payment":
        return "portal_push_payments"
    if kind in {"key_created", "key_expiry", "key_expired", "key_renewed"}:
        return "portal_push_subscriptions"
    return None


async def filter_subscriptions(context, subscriptions):
    from sqlalchemy import select
    from database.models import IdentityNotifPref, WebPushSubscription

    key = preference_key(context["type"])
    if not key or not context["identity_id"]:
        return subscriptions
    session = context["session"]
    # A preference lookup must not poison a payment's surrounding transaction.
    async with session.begin_nested():
        enabled = await session.scalar(select(IdentityNotifPref.enabled).where(
            IdentityNotifPref.identity_id == context["identity_id"], IdentityNotifPref.channel == key))
        if enabled is not False:
            return subscriptions
        endpoints = set((await session.scalars(select(WebPushSubscription.endpoint).where(
            WebPushSubscription.identity_id == context["identity_id"],
            WebPushSubscription.endpoint.in_([s.get("endpoint") for s in subscriptions])))).all())
    return [s for s in subscriptions if s.get("endpoint") not in endpoints]


def install():
    from database import web_notifications
    from services import web_push
    from services.tickets import delivery
    from logger import logger

    if getattr(web_push.send_push_to_many, "_portal_preferences", False):
        return
    original_create = web_notifications.create_notification
    original_send = web_push.send_push_to_many
    original_ticket_push = delivery._webpush_client

    @wraps(original_ticket_push)
    async def ticket_push(session, identity_id, title, body, url):
        # Tickets retain a direct import of create_notification from before the
        # module loads. Supply context at their own delivery boundary instead.
        token = _context.set({"session": session, "identity_id": identity_id,
            "type": "ticket", "title": title, "body": body,
            "admin": str(url).startswith("/admin/")})
        try:
            return await original_ticket_push(session, identity_id, title, body, url)
        finally:
            _context.reset(token)

    @wraps(original_create)
    async def create(session, **kwargs):
        notification = await original_create(session, **kwargs)
        data = kwargs.get("data") or {}
        href = str(data.get("href") or data.get("url") or "")
        _context.set({"session": session, "identity_id": kwargs.get("identity_id"),
                      "type": kwargs.get("type", "system"), "title": kwargs.get("title"),
                      "body": kwargs.get("message", ""), "admin": href.startswith("/admin/")})
        return notification

    @wraps(original_send)
    async def send(subscriptions, title, body, url="/dashboard", tag="solo-notification"):
        context = _context.get()
        _context.set(None)
        if context and not context["admin"] and context["title"] == title and context["body"] == body:
            try:
                subscriptions = await filter_subscriptions(context, subscriptions)
            except Exception:
                logger.warning("[Portal:Push] Preference lookup unavailable; using native delivery")
        if not subscriptions:
            return 0, []
        return await original_send(subscriptions, title, body, url, tag)

    send._portal_preferences = True
    web_notifications.create_notification = create
    web_push.send_push_to_many = send
    delivery._webpush_client = ticket_push
