"""Keep routine reads out of the site access log and expire committed account data."""
from functools import wraps
import re
import sys

ROUTINE_READS = frozenset({
    '/api/auth/me', '/api/auth/summary', '/api/site-config', '/api/notifications',
    '/api/keys', '/api/keys/actions-config', '/api/tariffs/public', '/api/tariffs/config-price',
    '/api/bonus/daily/me', '/api/portal/login-methods', '/api/portal/subscription-mode',
    '/api/portal/giveaways/config', '/api/portal/partner-transfer/options',
    '/api/partners/conditions', '/api/partners/finance/me', '/api/partners/payout-method/me',
    '/api/partners/invited/me',
})
ROUTINE_DETAIL = re.compile(r'/api/(?:keys/[^/]+/details|web/pages/[^/]+|portal/checkout/[0-9a-fA-F-]{36})')


def routine_access(method, path, status_code, duration_ms, result, preview=False):
    if result != 'success' or not 200 <= status_code < 300 or duration_ms >= 1000:
        return False
    path = path.rstrip('/')
    if method == 'POST':
        if path in ('/api/web/analytics/page-views', '/api/payment-links/quote'):
            return True
        return preview and (path == '/api/tariffs/purchase' or bool(re.fullmatch(r'/api/keys/[^/]+/renew', path)))
    return method in ('GET', 'HEAD') and (path in ROUTINE_READS or bool(ROUTINE_DETAIL.fullmatch(path)))


def install_access_filter():
    import audit

    original = audit.log_api_access
    if getattr(original, '_site_activity_filter', False) is True:
        return

    @wraps(original)
    def filtered(request, *, status_code, duration_ms, result, **kwargs):
        preview = request.query_params.get('preview') == 'true'
        if not routine_access(request.method, request.url.path, status_code, duration_ms, result, preview):
            return original(request, status_code=status_code, duration_ms=duration_ms, result=result, **kwargs)

    filtered._site_activity_filter = True
    audit.log_api_access = filtered
    main = sys.modules.get('api.main')
    if getattr(main, 'log_api_access', None) is original:
        main.log_api_access = filtered


def defer_account_balance(session, owner):
    from core.redis_cache import cache_key
    from database.access.resolution import UserId, user_ref_cache_key
    from database.cache_purge import defer_purge

    defer_purge(session, cache_key('summary_counters', owner), user_ref_cache_key('balance', UserId(owner)))


def install_cache_hooks():
    from sqlalchemy import event, inspect
    from sqlalchemy.orm import Session
    from core.redis_cache import cache_key
    from database import partners
    from database.access.resolution import UserId, user_ref_cache_key
    from database.cache_purge import defer_purge
    from database.models import Key

    original = partners.create_partner_payout
    if getattr(original, '_site_cache_hook', False) is True:
        return

    @wraps(original)
    async def create_payout(session, user_id, *args, **kwargs):
        result = await original(session, user_id, *args, **kwargs)
        defer_account_balance(session, user_id)
        return result

    def key_changes(session, flush_context):
        # The native API commits, then flushes these keys. No Redis I/O occurs
        # during flush, so readers cannot repopulate the cache before commit.
        for row in session.new | session.dirty | session.deleted:
            if not isinstance(row, Key):
                continue
            state = inspect(row)
            owner = state.dict.get('user_id')
            owners = {owner, *state.attrs.user_id.history.deleted}
            if state.identity:
                owners.add(state.identity[0])
            for uid in owners - {None}:
                defer_purge(session, cache_key('keys_list', uid), cache_key('key_count', uid),
                            user_ref_cache_key('keys_list', UserId(uid)), user_ref_cache_key('key_count', UserId(uid)))
            client_id = state.dict.get('client_id') or (state.identity and state.identity[1])
            if client_id:
                defer_purge(session, cache_key('key_actions', client_id))

    event.listen(Session, 'after_flush', key_changes)
    create_payout._site_cache_hook = True
    partners.create_partner_payout = create_payout
