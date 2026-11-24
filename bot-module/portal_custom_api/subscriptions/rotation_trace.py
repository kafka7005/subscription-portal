from contextlib import contextmanager
from contextvars import ContextVar
from time import monotonic
from uuid import uuid4

_active = ContextVar("subscription_rotation", default=None)


def stage(name):
    scope = _active.get()
    if scope:
        from logger import logger
        reference, source, start = scope
        logger.info("[Site:Rotation] op={} source={} stage={} elapsed_ms={}",
                    reference, source, name, int((monotonic()-start)*1000))


@contextmanager
def operation(source):
    token = _active.set((uuid4().hex, source, monotonic()))
    try:
        stage("started")
        yield
    except Exception:
        stage("failed")
        raise
    finally:
        _active.reset(token)


def telegram_failure(exc):
    if isinstance(exc, TimeoutError) or type(exc).__name__ in ('TelegramNetworkError','TelegramServerError'):
        return 'telegram_result_unknown'
    if type(exc).__name__ == 'TelegramForbiddenError':
        return 'telegram_forbidden'
    if type(exc).__name__ == 'TelegramRetryAfter':
        return 'telegram_rate_limited'
    return 'telegram_failed'


async def telegram_result(make_request, bot, method):
    from aiogram.methods import SendMessage
    scope = _active.get()
    if not scope or scope[1] != 'telegram' or not isinstance(method, SendMessage) or 'Ваша подписка была перевыпущена' not in (method.text or ''):
        return await make_request(bot, method)
    try:
        result = await make_request(bot, method)
    except Exception as exc:
        stage(telegram_failure(exc))
        raise
    stage("telegram_accepted")
    return result
