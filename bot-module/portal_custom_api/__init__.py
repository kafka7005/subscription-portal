"""Вход в приложения Service Portal через личный кабинет (OAuth 2.0 + PKCE, RFC 8252)."""
__all__ = ("router",)
from .log_privacy import install as _install_log_guard

_install_log_guard()
from .router import router
