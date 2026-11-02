import time
from collections import OrderedDict, deque
from datetime import UTC, datetime

from fastapi import Depends, Header, HTTPException, Request

from . import db, security
from .config import settings

class SlidingWindow:
    """In-memory sliding-window counters with a hard cap on distinct keys (least-recently-used keys are evicted).
    The cap means a flood of random keys can never grow memory without bound or wipe everyone's counters at once."""

    def __init__(self, max_keys: int = 50_000):
        self.max_keys, self._d = max_keys, OrderedDict()

    def _bucket(self, key: str) -> deque:
        q = self._d.get(key)
        if q is None:
            q = self._d[key] = deque()
            if len(self._d) > self.max_keys:
                for _ in range(self.max_keys // 10):
                    self._d.popitem(last=False)
        else:
            self._d.move_to_end(key)
        return q

    def count(self, key: str, window: int) -> int:
        q, now = self._bucket(key), time.monotonic()
        while q and now - q[0] > window:
            q.popleft()
        return len(q)

    def add(self, key: str) -> None:
        self._bucket(key).append(time.monotonic())

    def hit(self, key: str, limit: int, window: int) -> bool:
        """Record a hit; True means the caller is over the limit (and the hit is not recorded)."""
        if self.count(key, window) >= limit:
            return True
        self.add(key)
        return False

    def clear(self, key: str | None = None) -> None:
        self._d.clear() if key is None else self._d.pop(key, None)


# Two separate stores: visitor traffic can never evict login-lockout counters.
chat_limits = SlidingWindow()
auth_limits = SlidingWindow()


def limited(key: str, limit: int, window: int = 60) -> bool:
    return chat_limits.hit(key, limit, window)


def auth_limited(key: str, limit: int, window: int = 60) -> bool:
    return auth_limits.hit(key, limit, window)


def failures(key: str, window: int) -> int:
    return auth_limits.count(key, window)


def record(key: str) -> None:
    auth_limits.add(key)


def forget(key: str) -> None:
    auth_limits.clear(key)


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
    return role == "admin" or (expires_at is not None and expires_at > datetime.now(UTC))


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
