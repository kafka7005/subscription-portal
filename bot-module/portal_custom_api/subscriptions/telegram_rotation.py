"""Bind the subscription for the native Telegram link-replacement callback."""
from contextvars import ContextVar

from .rotation import revoke_current_profile


_callback_scope = ContextVar('subscription_rotation_scope', default=None)


async def rotation_scope(handler, event, data):
    if not (getattr(event, 'data', '') or '').startswith('confirm_recreate|'):
        return await handler(event, data)
    from middlewares.session import operation_session

    async with operation_session(data['session']) as session:
        token = _callback_scope.set((session, data['admin_user_ref']))
        try:
            return await handler(event, {**data, 'session': session})
        finally:
            _callback_scope.reset(token)


class BoundClient:
    def __init__(self, client, session, owner):
        self.client = client
        self.session = session
        self.owner = owner

    def __getattr__(self, name):
        return getattr(self.client, name)

    async def revoke_user_subscription(self, client_id, *, username):
        from database.keys import lock_owned_key_for_operation

        key = await lock_owned_key_for_operation(self.session, self.owner, client_id, username)
        if key is None:
            return None
        return await revoke_current_profile(self.client, key)


class LifecyclePanel:
    def __init__(self, panel):
        self.panel = panel

    def __getattr__(self, name):
        return getattr(self.panel, name)

    def RemnawaveAPI(self, *args, **kwargs):
        client = self.panel.RemnawaveAPI(*args, **kwargs)
        scope = _callback_scope.get()
        return BoundClient(client, *scope) if scope is not None else client


def install():
    from handlers.admin.users.users_keys import lifecycle
    from logger import logger

    if isinstance(lifecycle.remnawave_panel, LifecyclePanel):
        return
    lifecycle.router.callback_query.middleware(rotation_scope)
    lifecycle.remnawave_panel = LifecyclePanel(lifecycle.remnawave_panel)
    logger.info("[Subscriptions] Telegram link rotation binding ready")
