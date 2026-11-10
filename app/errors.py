"""Remembers recent unhandled server errors so the owner can see them in the dashboard (Owner -> Status) without log access."""
import logging
import secrets
import time
from collections import deque

log = logging.getLogger("errors")
_recent: deque = deque(maxlen=50)


def record(request, exc: BaseException) -> str:
    ref = secrets.token_hex(3)
    _recent.appendleft({
        "ref": ref, "at": time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()),
        "request": f"{request.method} {request.url.path}", "error": f"{type(exc).__name__}: {str(exc)[:300]}",
    })
    log.error("unhandled error ref=%s %s %s", ref, request.method, request.url.path, exc_info=exc)
    return ref


def recent() -> list[dict]:
    return list(_recent)
