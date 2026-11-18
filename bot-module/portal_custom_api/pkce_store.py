"""Validate the binding before atomically consuming a short-lived grant."""
import base64
import hashlib
import json
import re
import secrets


async def consume_code(redis, key, client_id, redirect_uri, verifier):
    if not re.fullmatch(r"[A-Za-z0-9._~-]{43,128}", verifier):
        return None
    raw = await redis.get(key)
    if not raw:
        return None
    grant = json.loads(raw)
    if grant["cid"] != client_id or grant["ru"] != redirect_uri:
        return None
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    if not secrets.compare_digest(challenge, grant["ch"]):
        return None
    # Only one caller can remove a live key, even if several already read it.
    return grant if await redis.delete(key) == 1 else None
