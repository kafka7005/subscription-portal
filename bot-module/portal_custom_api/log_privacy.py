"""Strip credentials and exception locals before Loguru formats any native sink."""
import logging
import re
from urllib.parse import unquote

# Inspect an unquoted copy too, for credentials inside nested URLs.
_SENSITIVE = re.compile(
    r"(?:\d{5,16}(?::|%3a)[\w-]{20,}|authorization\s*[:=]|\bbearer\s+|"
    r"\b(?:cookie|set-cookie|password|passwd|secret|api[_-]?key|[\w-]*token|init_data)\b['\"]?\s*[:=]|"
    r"-----BEGIN [^\n]*PRIVATE KEY|(?:vless|vmess|trojan|ss)://|"
    r"https?://\S+/\S+|\b[A-Z0-9._%+-]{1,64}@[A-Z0-9.-]+\.[A-Z]{2,}|"
    r"\b(?:github_pat_|gh[pousr]_|sk_live_|live_)[A-Za-z0-9_]{16,}|\beyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)", re.I,
)


def safe_message(message):
    if _SENSITIVE.search(message) or ('%' in message and _SENSITIVE.search(unquote(unquote(message)))):
        return "[sensitive log message suppressed]"
    return message


def safe_exception(exc_type, tb):
    frames = []
    while tb:
        frames.append(f"{tb.tb_frame.f_code.co_name}:{tb.tb_lineno}")
        tb = tb.tb_next
    return (exc_type.__name__ if exc_type else "Exception") + " " + " > ".join(frames[-12:])


def sanitize(record):
    message = safe_message(record["message"])
    exc = record.get("exception")
    if exc:
        # Loguru diagnose interpolates locals *after* patchers run. Discard the
        # exception object itself, retaining code locations without source/locals.
        message += " | " + safe_exception(exc.type, exc.traceback)
        record["exception"] = None
    record["message"] = message


def install():
    from logger import logger
    prior = logger._core.patcher
    if getattr(prior, "_privacy_guard", False):
        return

    def patch(record):
        if prior:
            prior(record)
        sanitize(record)

    patch._privacy_guard = True
    logger.configure(patcher=patch)

    # Some HTTP libraries do not propagate to the native Loguru interceptor.
    factory = logging.getLogRecordFactory()

    def safe_record(*args, **kwargs):
        record = factory(*args, **kwargs)
        try:
            original = record.getMessage()
            message = safe_message(original)
        except Exception:
            original, message = None, "[unformattable log message]"
        if record.exc_info:
            message += " | " + safe_exception(record.exc_info[0], record.exc_info[2])
        if message != original:
            if record.name == 'uvicorn.access' and isinstance(record.args, tuple) and len(record.args) == 5:
                # Uvicorn's formatter unpacks the HTTP tuple even for suppressed records.
                status = record.args[4]
                record.msg = '%s - "%s %s HTTP/%s" %d'
                record.args = ('-', '-', '[redacted]', '-', status if type(status) is int else 0)
            else:
                record.msg, record.args = message, ()
        record.exc_info = record.exc_text = record.stack_info = None
        return record

    logging.setLogRecordFactory(safe_record)
