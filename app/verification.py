"""Short-lived one-time codes sent by email. Only an HMAC of the code is stored, codes expire, allow 5 wrong tries, and work once."""
import hashlib
import hmac
import secrets
from datetime import UTC, datetime

from . import db
from .config import settings

TTL_MINUTES = 10
MAX_ATTEMPTS = 5


def _hash(uid: int, purpose: str, code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"{uid}:{purpose}:{code}".encode(), hashlib.sha256).hexdigest()


async def issue(uid: int, purpose: str) -> str:
    """Create a fresh code (any earlier unused code for this purpose stops working) and return it for emailing."""
    code = f"{secrets.randbelow(10**6):06d}"
    async with db.pool.acquire() as c, c.transaction():
        await c.execute("DELETE FROM email_codes WHERE user_id=$1 AND purpose=$2", uid, purpose)
        await c.execute(
            "INSERT INTO email_codes(user_id, purpose, code_hash, expires_at) VALUES($1,$2,$3, now() + make_interval(mins => $4))",
            uid, purpose, _hash(uid, purpose, code), TTL_MINUTES)
    return code


async def discard(uid: int, purpose: str) -> None:
    await db.pool.execute("DELETE FROM email_codes WHERE user_id=$1 AND purpose=$2", uid, purpose)


async def check(uid: int, purpose: str, code: str) -> bool:
    """True once, for the right unexpired code. Wrong guesses are counted; the code dies after MAX_ATTEMPTS."""
    row = await db.pool.fetchrow(
        "SELECT id, code_hash, attempts, expires_at FROM email_codes WHERE user_id=$1 AND purpose=$2 ORDER BY id DESC LIMIT 1", uid, purpose)
    if not row:
        return False
    if row["expires_at"] < datetime.now(UTC) or row["attempts"] >= MAX_ATTEMPTS:
        await db.pool.execute("DELETE FROM email_codes WHERE id=$1", row["id"])
        return False
    if not hmac.compare_digest(row["code_hash"], _hash(uid, purpose, code.strip())):
        await db.pool.execute("UPDATE email_codes SET attempts = attempts + 1 WHERE id=$1", row["id"])
        return False
    return bool(await db.pool.fetchval("DELETE FROM email_codes WHERE id=$1 RETURNING 1", row["id"]))  # single use, even under races
