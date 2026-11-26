"""API входа в приложения Service Portal через сайт.

Схема: OAuth 2.0 Authorization Code + PKCE для нативных приложений (RFC 8252, RFC 7636).

  POST /api/app/authorize  — сайт (по cookie) выдаёт одноразовый код для приложения
  POST /api/app/token      — приложение меняет код или refresh-токен на токены
  GET  /api/app/me         — профиль и ссылки подписок
  POST /api/app/logout     — выход
  POST /api/app/feedback   — «Сообщить о проблеме» (создаёт обращение в поддержку)

access_token — обычная сессия бота (identity_sessions): видна в кабинете среди сеансов,
и если её отключить там, приложение выйдет при следующем обновлении.
"""

import os
import json
import re
import secrets

from datetime import datetime, timedelta
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.depends import get_session, hash_token, verify_identity_token
from core.redis_cache import _get_redis, cache_delete, cache_key
from database import get_keys, identities as idb, identity_sessions as idsess
from database.models import IdentitySession
from logger import logger
from .accounts.pkce_store import consume_code


BRAND_NAME = os.environ.get("APP_BRAND_NAME", "Subscription Portal")
CLIENTS = {
    "portal-desktop": os.environ.get("APP_CLIENT_NAME", BRAND_NAME + " Desktop"),
}
REDIRECT_RE = re.compile(r"^http://127\.0\.0\.1:(\d{1,5})/callback$")
CODE_TTL_SEC = 60
REFRESH_TTL_DAYS = 90
USER_AGENT_PREFIX = "Portal-App"

_table_ready = False


class AuthorizeBody(BaseModel):
    client_id: str
    redirect_uri: str
    state: str | None = None
    code_challenge: str
    code_challenge_method: str = "S256"


class DeviceInfo(BaseModel):
    hwid: str | None = None
    os: str | None = None
    osVersion: str | None = None
    model: str | None = None


class TokenBody(BaseModel):
    grant_type: str
    client_id: str
    code: str | None = None
    code_verifier: str | None = None
    redirect_uri: str | None = None
    refresh_token: str | None = None
    device: DeviceInfo | None = None


class FeedbackBody(BaseModel):
    message: str = ""
    report: str | None = None
    appVersion: str | None = None
    os: str | None = None


def _check_redirect(uri: str) -> bool:
    m = REDIRECT_RE.match(uri or "")
    return bool(m) and 0 < int(m.group(1)) < 65536


def _invalid_grant() -> JSONResponse:
    return JSONResponse({"error": "invalid_grant"}, status_code=400)


async def _ensure_table(session: AsyncSession) -> None:
    global _table_ready
    if _table_ready:
        return
    await session.execute(text(
        "CREATE TABLE IF NOT EXISTS kz_app_refresh_tokens ("
        " token_hash VARCHAR(64) PRIMARY KEY,"
        " session_id VARCHAR(36) NOT NULL,"
        " identity_id VARCHAR(36) NOT NULL,"
        " client_id VARCHAR(64) NOT NULL,"
        " hwid VARCHAR(128),"
        " created_at TIMESTAMP NOT NULL,"
        " expires_at TIMESTAMP NOT NULL)"
    ))
    await session.execute(text("CREATE INDEX IF NOT EXISTS ix_kz_app_refresh_session ON kz_app_refresh_tokens (session_id)"))
    _table_ready = True


def _bearer(request: Request) -> str | None:
    raw = request.headers.get("authorization") or ""
    if raw[:7].lower() != "bearer ":
        return None
    return raw[7:].strip() or None


async def _session_from_bearer(session: AsyncSession, request: Request):
    token = _bearer(request)
    if not token:
        return None, None
    sess = await idsess.get_session_by_token_hash(session, hash_token(token))
    if sess is None or (sess.expires_at is not None and sess.expires_at <= datetime.utcnow()):
        return None, None
    identity = await idb.get_identity_by_id(session, sess.identity_id)
    if identity is None:
        return None, None
    await idsess.touch_session_last_seen(session, sess)
    return sess, identity


def _provider(identity) -> str:
    if getattr(identity, "tg_id", None):
        return "telegram"
    if getattr(identity, "yandex_sub", None):
        return "yandex"
    if getattr(identity, "google_sub", None):
        return "google"
    return "email"


def _user_dict(identity) -> dict:
    name = (
        identity.display_name
        or (f"@{identity.username}" if identity.username else None)
        or identity.email
        or "Пользователь"
    )
    return {"id": str(identity.id), "name": name, "email": identity.email, "provider": _provider(identity)}


def _device_label(client_id: str, device: DeviceInfo | None) -> str:
    base = CLIENTS.get(client_id, BRAND_NAME)
    parts = [p for p in ((device.model if device else None), (device.os if device else None)) if p]
    return (f"{base} · {' · '.join(parts)}" if parts else base)[:128]


def _client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[-1].strip()[:64]
    return request.client.host if request.client else None


async def _issue(session: AsyncSession, *, identity, client_id: str, device: DeviceInfo | None,
                 ip: str | None, existing: IdentitySession | None = None) -> dict:
    """Создаёт (или обновляет) сессию бота и выдаёт новую пару токенов."""
    await _ensure_table(session)
    access = secrets.token_urlsafe(32)
    refresh = secrets.token_urlsafe(48)
    now = datetime.utcnow()
    if existing is None:
        hwid = (device.hwid if device else None) or secrets.token_hex(8)
        user_agent = f"{USER_AGENT_PREFIX}/{client_id}/{hwid}"[:500]
        label = _device_label(client_id, device)
    else:
        user_agent = existing.user_agent
        label = existing.device_label
        try:
            await cache_delete(cache_key("auth_actor", existing.token_hash))
        except Exception:
            pass
    # Один и тот же user_agent у бота = одно устройство: повторный вход заменяет старую сессию.
    sess = await idsess.create_identity_session(
        session, identity=identity, token_hash=hash_token(access), user_agent=user_agent, ip=ip, device_label=label,
    )
    if existing is None:
        await session.execute(text("DELETE FROM kz_app_refresh_tokens WHERE session_id = :sid"), {"sid": sess.id})
    await session.execute(
        text(
            "INSERT INTO kz_app_refresh_tokens (token_hash, session_id, identity_id, client_id, hwid, created_at, expires_at) "
            "VALUES (:h, :sid, :iid, :cid, :hwid, :now, :exp)"
        ),
        {
            "h": hash_token(refresh), "sid": sess.id, "iid": identity.id, "cid": client_id,
            "hwid": (device.hwid if device else None), "now": now, "exp": now + timedelta(days=REFRESH_TTL_DAYS),
        },
    )
    expires_in = int((sess.expires_at - now).total_seconds()) if sess.expires_at else 30 * 24 * 3600
    return {
        "access_token": access,
        "refresh_token": refresh,
        "token_type": "Bearer",
        "expires_in": max(expires_in, 60),
        "user": _user_dict(identity),
    }


def private_response(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def get_api_routers(version: int) -> list[APIRouter]:
    router = APIRouter(prefix="/api/app", tags=["App auth"], dependencies=[Depends(private_response)])

    @router.get("/clients")
    async def clients() -> dict:
        """Список приложений, которым можно входить через сайт (для страницы подтверждения)."""
        return {"clients": [{"id": k, "name": v} for k, v in CLIENTS.items()]}

    @router.post("/authorize")
    async def authorize(body: AuthorizeBody, identity=Depends(verify_identity_token)) -> dict:
        if body.client_id not in CLIENTS:
            raise HTTPException(status_code=400, detail="Неизвестное приложение")
        if not _check_redirect(body.redirect_uri):
            raise HTTPException(status_code=400, detail="Недопустимый адрес возврата")
        if body.code_challenge_method != "S256" or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", body.code_challenge or ""):
            raise HTTPException(status_code=400, detail="Нужен code_challenge (S256)")
        code = secrets.token_urlsafe(32)
        try:
            redis = await _get_redis()
            await redis.set(cache_key("app_pkce_v2", hash_token(code)), json.dumps({
                "iid": str(identity.id), "cid": body.client_id, "ch": body.code_challenge,
                "ru": body.redirect_uri,
            }), ex=CODE_TTL_SEC)
        except Exception:
            raise HTTPException(status_code=503, detail="Сервис входа временно недоступен")
        query = {"code": code}
        if body.state is not None:
            query["state"] = body.state
        logger.info("[AppAuth] Клиент {} разрешил вход в {}", identity.id, body.client_id)
        return {"redirect": f"{body.redirect_uri}?{urlencode(query)}"}

    @router.post("/token")
    async def token(body: TokenBody, request: Request, session: AsyncSession = Depends(get_session)):
        if body.client_id not in CLIENTS:
            return _invalid_grant()
        await _ensure_table(session)

        if body.grant_type == "authorization_code":
            if not body.code or not body.code_verifier or not body.redirect_uri:
                return _invalid_grant()
            key = cache_key("app_pkce_v2", hash_token(body.code))
            try:
                redis = await _get_redis()
                data = await consume_code(redis, key, body.client_id, body.redirect_uri, body.code_verifier)
            except Exception:
                raise HTTPException(status_code=503, detail="Сервис входа временно недоступен")
            if data is None:
                return _invalid_grant()
            identity = await idb.get_identity_by_id(session, data["iid"])
            if identity is None:
                return _invalid_grant()
            result = await _issue(session, identity=identity, client_id=body.client_id, device=body.device,
                                  ip=_client_ip(request))
            logger.info("[AppAuth] Клиент {} вошёл в {}", identity.id, body.client_id)
            return result

        if body.grant_type == "refresh_token":
            if not body.refresh_token:
                return _invalid_grant()
            row = (await session.execute(
                text(
                    "DELETE FROM kz_app_refresh_tokens WHERE token_hash = :h "
                    "RETURNING session_id, identity_id, client_id, expires_at"
                ),
                {"h": hash_token(body.refresh_token)},
            )).first()
            if row is None or row.client_id != body.client_id or row.expires_at <= datetime.utcnow():
                return _invalid_grant()
            sess = await session.get(IdentitySession, row.session_id)
            if sess is None:  # сеанс отключили в кабинете
                return _invalid_grant()
            identity = await idb.get_identity_by_id(session, row.identity_id)
            if identity is None:
                return _invalid_grant()
            return await _issue(session, identity=identity, client_id=body.client_id, device=body.device,
                                ip=_client_ip(request), existing=sess)

        return JSONResponse({"error": "unsupported_grant_type"}, status_code=400)

    @router.get("/me")
    async def me(request: Request, session: AsyncSession = Depends(get_session)):
        _sess, identity = await _session_from_bearer(session, request)
        if identity is None:
            return JSONResponse({"error": "invalid_token"}, status_code=401)
        billing_user_id = await idb.ensure_billing_user_for_identity(session, identity)
        now_ms = int(datetime.utcnow().timestamp() * 1000)
        subs = []
        for key in await get_keys(session, billing_user_id):
            url = getattr(key, "remnawave_link", None) or getattr(key, "key", None)
            expiry = int(getattr(key, "expiry_time", 0) or 0)
            if not url or getattr(key, "is_frozen", False) or (expiry and expiry < now_ms):
                continue
            ref = str(getattr(key, "client_id", "") or getattr(key, "email", "") or "")
            name = getattr(key, "alias", None) or BRAND_NAME
            subs.append({"id": ref, "name": name, "url": url, "expiresAt": expiry or None})
        return {"user": _user_dict(identity), "subscriptions": subs}

    @router.post("/logout")
    async def logout(request: Request, session: AsyncSession = Depends(get_session)):
        sess, _identity = await _session_from_bearer(session, request)
        if sess is not None:
            await _ensure_table(session)
            await session.execute(text("DELETE FROM kz_app_refresh_tokens WHERE session_id = :sid"), {"sid": sess.id})
            token_hash = sess.token_hash
            await idsess.delete_session_by_token_hash(session, token_hash)
            try:
                await cache_delete(cache_key("auth_actor", token_hash))
            except Exception:
                pass
        return Response(status_code=204)

    @router.post("/feedback")
    async def feedback(body: FeedbackBody, request: Request, session: AsyncSession = Depends(get_session)):
        message = (body.message or "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="Пустое сообщение")
        _sess, identity = await _session_from_bearer(session, request)
        if identity is None:
            # Без входа обращение не к кому привязать — приложение само откроет чат поддержки.
            return JSONResponse({"error": "login_required"}, status_code=401)
        from services import tickets as svc

        meta = " · ".join(p for p in (f"Приложение {body.appVersion or '—'}", body.os or "") if p)
        text_body = f"{message[:4000]}\n\n— {meta}"
        if body.report:
            text_body += f"\n\nДиагностика:\n{body.report[:6000]}"
        try:
            ticket = await svc.create_ticket(
                session, identity_id=identity.id, body=text_body, subject="Проблема в приложении", source="web",
            )
        except svc.TicketRateLimited:
            raise HTTPException(status_code=429, detail="Слишком много обращений, подождите ответа")
        await svc.notify_agents_new_ticket(session, ticket=ticket)
        return {"ok": True, "ticket_id": str(ticket.id)}

    from .campaigns.broadcast_status import status_router, install_tracking
    install_tracking()
    from .accounts.web_actions import get_router
    from .staff.admin_audit import get_router as get_admin_audit_router
    from .subscriptions.single_subscription import get_router as subscription_router, install_completion_guard
    install_completion_guard()
    from .staff.bot_stats import get_router as bot_stats_router
    from .campaigns.giveaways import get_router as giveaways_router
    from .accounts.customer_tools import get_router as get_customer_tools_router
    from .staff.admin_operations import get_router as get_admin_operations_router
    from .payments.manual_autopay import get_router as get_manual_autopay_router
    from .payments.manual_autopay_admin import get_router as get_manual_autopay_admin_router
    from .support.canned_replies import get_router as get_canned_replies_router
    from .support.support_tools import get_router as get_support_tools_router
    from .support.support_reminders import get_router as get_support_reminders_router
    from .accounts.notification_preferences import install
    install()
    from .subscriptions.management import get_router as management_router
    from .site_activity import install_access_filter, install_cache_hooks
    install_access_filter()
    install_cache_hooks()
    from .payments.checkout_status import get_router as checkout_router
    from .staff.module_updates import router as module_updates_router
    from .accounts.reviews import get_router as reviews_router
    return [router, reviews_router('/api/portal'), module_updates_router, checkout_router('/api/portal'), management_router('/api/portal'), subscription_router('/api/portal', version), bot_stats_router('/api/portal'), giveaways_router('/api/portal'), status_router, get_router(), get_admin_audit_router(), get_customer_tools_router(), get_admin_operations_router(), get_manual_autopay_router(), get_manual_autopay_admin_router(), get_canned_replies_router(), get_support_tools_router(), get_support_reminders_router()]
