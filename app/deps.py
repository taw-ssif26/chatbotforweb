import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, Request

from . import db, security
from .config import settings

_hits: dict[str, deque] = defaultdict(deque)


def _prune(q: deque, window: int, now: float) -> None:
    while q and now - q[0] > window:
        q.popleft()


def limited(key: str, limit: int, window: int = 60) -> bool:
    """Sliding-window limiter, in-memory (single worker). Records a hit; True means over the limit."""
    now = time.monotonic()
    if len(_hits) > 20000:
        _hits.clear()
    q = _hits[key]
    _prune(q, window, now)
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def failures(key: str, window: int) -> int:
    q = _hits.get(key)
    if not q:
        return 0
    _prune(q, window, time.monotonic())
    return len(q)


def record(key: str) -> None:
    _hits[key].append(time.monotonic())


def forget(key: str) -> None:
    _hits.pop(key, None)


def client_ip(request: Request) -> str:
    if settings.client_ip_header:
        v = request.headers.get(settings.client_ip_header, "").strip()
        if v:
            return v
    parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    if parts:
        return parts[max(len(parts) - settings.proxy_hops, 0)]
    return request.client.host if request.client else "?"


def live(role: str, active: bool, expires_at) -> bool:
    if not active:
        return False
    return role == "admin" or (expires_at is not None and expires_at > datetime.now(timezone.utc))


async def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Not signed in")
    tok = security.read_token(authorization[7:])
    u = await db.pool.fetchrow("SELECT * FROM users WHERE id=$1", tok[0]) if tok else None
    if not u or not u["active"] or u["token_version"] != tok[1]:
        raise HTTPException(401, "Not signed in")
    return dict(u)


async def require_admin(u: dict = Depends(current_user)) -> dict:
    if u["role"] != "admin":
        raise HTTPException(403, "Admin only")
    return u


async def require_live(u: dict = Depends(current_user)) -> dict:
    if not live(u["role"], u["active"], u["expires_at"]):
        raise HTTPException(402, "Your subscription has expired. Contact support to renew.")
    return u
