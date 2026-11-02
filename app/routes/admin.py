"""Owner (admin) API: clients, models, agency profile, platform keys, stats."""
from datetime import UTC, datetime

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db, errors, llm, security
from ..config import settings
from ..deps import require_admin
from ..plans import CLIENT_PLANS

router = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])


def month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


@router.get("/stats")
async def stats():
    q = db.pool.fetchval
    return {
        "clients": await q("SELECT count(*) FROM users WHERE role='client'"),
        "live": await q("SELECT count(*) FROM users WHERE role='client' AND active AND expires_at > now()"),
        "expiring_7d": await q("SELECT count(*) FROM users WHERE role='client' AND active AND expires_at BETWEEN now() AND now() + interval '7 days'"),
        "bots": await q("SELECT count(*) FROM bots"),
        "messages_month": await q("SELECT count(*) FROM messages WHERE role='user' AND created_at >= date_trunc('month', now())"),
        "platform_msgs_month": await q("SELECT coalesce(sum(platform_msgs),0) FROM usage WHERE month=$1", month()),
    }


# ---------- clients ----------
@router.get("/clients")
async def clients():
    rows = await db.pool.fetch(
        """SELECT u.id, u.email, u.name, u.plan, u.active, u.expires_at, u.notes, u.created_at,
                  (SELECT count(*) FROM bots b WHERE b.user_id=u.id) AS bots,
                  coalesce((SELECT platform_msgs FROM usage WHERE user_id=u.id AND month=$1), 0) AS msgs
           FROM users u WHERE u.role='client' ORDER BY u.created_at DESC""", month())
    return [dict(r) for r in rows]


class ClientIn(BaseModel):
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=200)
    name: str = Field(default="", max_length=100)
    password: str = Field(min_length=8, max_length=200)
    plan: str = "starter"
    days: int = Field(default=30, ge=0, le=3650)


@router.post("/clients")
async def create_client(body: ClientIn):
    if body.plan not in CLIENT_PLANS:
        raise HTTPException(400, "Unknown plan")
    try:
        await db.pool.execute(
            "INSERT INTO users(email,password_hash,name,plan,expires_at) VALUES(lower($1),$2,$3,$4, now() + make_interval(days => $5))",
            body.email.strip(), await security.hash_pw_async(body.password), body.name.strip(), body.plan, body.days)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "A user with that email already exists") from None
    return {"ok": True}


class ClientPatch(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=1000)
    plan: str | None = None
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=200)
    extend_days: int | None = Field(default=None, ge=1, le=3650)   # the "payment received" button
    expires_at: datetime | None = None


@router.patch("/clients/{uid}")
async def patch_client(uid: int, body: ClientPatch):
    if not await db.pool.fetchval("SELECT 1 FROM users WHERE id=$1 AND role='client'", uid):
        raise HTTPException(404, "Client not found")
    d = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k == "expires_at"}
    if d.get("plan") and d["plan"] not in CLIENT_PLANS:
        raise HTTPException(400, "Unknown plan")
    async with db.pool.acquire() as c, c.transaction():
        if "password" in d:
            await c.execute(
                "UPDATE users SET password_hash=$1, token_version = token_version + 1 WHERE id=$2",
                await security.hash_pw_async(d.pop("password")), uid)
        if "extend_days" in d:
            await c.execute(
                "UPDATE users SET expires_at = GREATEST(coalesce(expires_at, now()), now()) + make_interval(days => $1) WHERE id=$2",
                d.pop("extend_days"), uid)
        for col in ("name", "notes", "plan", "active", "expires_at"):  # fixed allowlist, never user text
            if col in d:
                await c.execute(f"UPDATE users SET {col}=$1 WHERE id=$2", d[col], uid)  # noqa: S608  # nosec B608 - column names come from a fixed allowlist
    return {"ok": True}


@router.delete("/clients/{uid}")
async def delete_client(uid: int):
    await db.pool.execute("DELETE FROM users WHERE id=$1 AND role='client'", uid)
    return {"ok": True}


# ---------- models ----------
@router.get("/models")
async def list_models():
    return [dict(r) for r in await db.pool.fetch("SELECT * FROM models ORDER BY provider, id")]


class ModelIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    provider: str
    model_id: str = Field(min_length=1, max_length=120)
    premium_only: bool = False


@router.post("/models")
async def add_model(body: ModelIn):
    if body.provider not in llm.PROVIDERS:
        raise HTTPException(400, "Unknown provider")
    try:
        await db.pool.execute(
            "INSERT INTO models(label,provider,model_id,premium_only) VALUES($1,$2,$3,$4)",
            body.label.strip(), body.provider, body.model_id.strip(), body.premium_only)
    except asyncpg.UniqueViolationError:
        raise HTTPException(409, "That model already exists") from None
    return {"ok": True}


class ModelPatch(BaseModel):
    label: str | None = None
    enabled: bool | None = None
    premium_only: bool | None = None


@router.patch("/models/{mid}")
async def patch_model(mid: int, body: ModelPatch):
    for col, val in body.model_dump(exclude_unset=True).items():
        if val is not None:  # ModelPatch fields are a fixed allowlist: label, enabled, premium_only
            await db.pool.execute(f"UPDATE models SET {col}=$1 WHERE id=$2", val, mid)  # noqa: S608  # nosec B608 - column names come from a fixed allowlist
    return {"ok": True}


@router.delete("/models/{mid}")
async def delete_model(mid: int):
    await db.pool.execute("DELETE FROM models WHERE id=$1", mid)
    return {"ok": True}


# ---------- agency profile + platform keys ----------
class AgencyIn(BaseModel):
    agency_mode: str = Field(pattern="^(active|ask)$")
    agency_name: str = Field(max_length=100)
    agency_site: str = Field(max_length=300)
    agency_bio: str = Field(max_length=1500)
    agency_works: str = Field(max_length=3000)


@router.get("/settings")
async def get_settings():
    have = await db.platform_providers()
    return {"agency": await db.agency(), "providers": {p: p in have for p in llm.PROVIDERS}}


@router.put("/settings")
async def put_settings(body: AgencyIn):
    for k, v in body.model_dump().items():
        await db.pool.execute(
            "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", k, v.strip())
    return {"ok": True}


class PlatformKeyIn(BaseModel):
    key: str = Field(max_length=300)


@router.put("/platform-keys/{provider}")
async def set_platform_key(provider: str, body: PlatformKeyIn):
    if provider not in llm.PROVIDERS:
        raise HTTPException(400, "Unknown provider")
    k = body.key.strip()
    if not k:
        await db.pool.execute("DELETE FROM settings WHERE key=$1", f"pk:{provider}")
    else:
        await db.pool.execute(
            "INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
            f"pk:{provider}", security.encrypt(k))
    return {"ok": True}


# ---------- status ----------
@router.get("/status")
async def status():
    def chk(status, label, fix=""):
        return {"status": status, "label": label, "fix": fix}
    out = []
    try:
        await db.pool.fetchval("SELECT 1")
        out.append(chk("ok", "Database is reachable"))
    except Exception as e:
        return {"checks": [chk("fail", "Database is NOT reachable", f"{type(e).__name__}: {e}. Check DATABASE_URL (use Neon's direct connection string, not the pooled one).")], "errors": errors.recent()}
    ver = await db.pool.fetchval("SELECT extversion FROM pg_extension WHERE extname='vector'")
    out.append(chk("ok", f"pgvector {ver} installed") if ver else chk("fail", "pgvector extension is missing", "Run CREATE EXTENSION vector; or use a Postgres with pgvector (Neon, pgvector Docker image)."))
    done = {r["name"] for r in await db.pool.fetch("SELECT name FROM schema_migrations")}
    want = {f.name for f in db.MIGRATIONS.glob("*.sql")}
    out.append(chk("ok", f"Database is up to date ({len(done)} migrations)") if want <= done else chk("fail", "Database migrations are missing: " + ", ".join(sorted(want - done)), "Restart the service; migrations run at startup."))
    out.append(chk("ok", "Voyage embeddings key is set") if settings.voyage_api_key else chk("fail", "VOYAGE_API_KEY is not set", "Knowledge can't be indexed and bots can't search it until it is set."))
    out.append(chk("ok", "Tavily web-search key is set") if settings.tavily_api_key else chk("warn", "TAVILY_API_KEY is not set", "Premium web search will be skipped."))
    have = sorted(await db.platform_providers())
    out.append(chk("ok", "Platform AI keys: " + ", ".join(have)) if have else chk("warn", "No platform AI key is set", "Bots without their own key can't answer. Add one under Owner → Settings."))
    out.append(chk("ok", f"Public address: {settings.public_base_url}") if settings.public_base_url.startswith("https://") or "localhost" in settings.public_base_url
               else chk("warn", f"PUBLIC_BASE_URL is {settings.public_base_url}", "Use your https:// address."))
    errs = errors.recent()
    out.append(chk("ok", "No server errors since the last restart") if not errs else chk("warn", f"{len(errs)} server error(s) since the last restart", "Listed below with a reference code."))
    return {"checks": out, "errors": errs}
