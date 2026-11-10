import asyncio
import json
import logging
from pathlib import Path

import asyncpg
from pgvector.asyncpg import register_vector

from . import security
from .llm import PROVIDERS
from .config import settings

log = logging.getLogger("db")
pool = None  # RetryPool
SCHEMA = (Path(__file__).parent / "schema.sql").read_text()

DEFAULT_MODELS = [
    # label, provider, model_id, premium_only  (edit/add/disable in the admin dashboard)
    ("Claude Haiku 5.5", "anthropic", "claude-haiku-5-5", False),
    ("Claude Sonnet 5.5", "anthropic", "claude-sonnet-5-5", True),
    ("GPT-4o mini", "openai", "gpt-4o-mini", False),
    ("GPT-4o", "openai", "gpt-4o", True),
    ("Llama 3.3 70B (Groq)", "groq", "llama-3.3-70b-versatile", False),
    ("Llama 3.1 8B (Groq)", "groq", "llama-3.1-8b-instant", False),
]
MIGRATIONS = Path(__file__).parent / "migrations"
DEFAULT_SETTINGS = {
    "agency_mode": "active",  # active = soft, once-per-chat mention at a natural moment; ask = only when asked
    "agency_name": "Tawsif (TSMart)",
    "agency_site": "",
    "agency_bio": "Self-taught developer building AI automation, chatbots, and full-stack web apps with Python, FastAPI, PostgreSQL, Next.js and n8n.",
    "agency_works": "",
    # landing page (owner edits these under Owner -> Landing page)
    "site_headline": "Add an AI assistant to any website with one line of code",
    "site_subheadline": "Your own chat assistant that answers from your content, can search the web, and uses the AI model you choose. I set up your account personally.",
    "site_price_starter": "",
    "site_price_premium": "",
    "site_demo_bot": "",
    "site_contacts": "[]",
    "site_whatsapp_text": "Hi! I'd like to get the AI chatbot for my website.",
}


class RetryPool:
    """asyncpg pool that retries a query once when the connection died (serverless Postgres suspends idle compute)."""

    def __init__(self, inner):
        self._p = inner

    def __getattr__(self, name):  # acquire(), close(), ... pass straight through
        return getattr(self._p, name)

    async def _try(self, name, *a, **k):
        for attempt in (1, 2):
            try:
                return await getattr(self._p, name)(*a, **k)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError, asyncpg.exceptions.InvalidCachedStatementError,
                    ConnectionResetError, OSError) as e:
                if attempt == 2:
                    raise
                log.warning("database problem (%s), retrying once: %s", type(e).__name__, e)
                await asyncio.sleep(0.6)

    async def fetch(self, *a, **k): return await self._try("fetch", *a, **k)
    async def fetchrow(self, *a, **k): return await self._try("fetchrow", *a, **k)
    async def fetchval(self, *a, **k): return await self._try("fetchval", *a, **k)
    async def execute(self, *a, **k): return await self._try("execute", *a, **k)
    async def executemany(self, *a, **k): return await self._try("executemany", *a, **k)


async def _init_connection(conn) -> None:
    await register_vector(conn)
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")  # jsonb <-> dict


async def make_pool(url: str) -> RetryPool:
    return RetryPool(await asyncpg.create_pool(
        url, min_size=0, max_size=10, init=_init_connection,
        # No server-side statement cache: a deploy that adds a column (SELECT * !) must not break running connections,
        # and it keeps working behind PgBouncer-style poolers such as Neon's pooled connection string.
        statement_cache_size=0,
        max_inactive_connection_lifetime=60,  # drop idle conns before Neon suspends compute (5 min) and kills them
    ))


async def init() -> None:
    global pool
    conn = await asyncpg.connect(settings.database_url)
    try:
        await conn.execute(SCHEMA)  # idempotent baseline; creates the pgvector extension first
        await migrate(conn)
    finally:
        await conn.close()
    pool = await make_pool(settings.database_url)


async def migrate(conn) -> None:
    """Apply app/migrations/*.sql in order, once each. An advisory lock keeps concurrent boots safe."""
    await conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
    await conn.execute("SELECT pg_advisory_lock(727274)")
    try:
        done = {r["name"] for r in await conn.fetch("SELECT name FROM schema_migrations")}
        for f in sorted(MIGRATIONS.glob("*.sql")):
            if f.name not in done:
                async with conn.transaction():
                    await conn.execute(f.read_text())
                    await conn.execute("INSERT INTO schema_migrations(name) VALUES($1)", f.name)
    finally:
        await conn.execute("SELECT pg_advisory_unlock(727274)")


async def close() -> None:
    if pool:
        await pool.close()


async def seed() -> None:
    async with pool.acquire() as c:
        if not await c.fetchval("SELECT 1 FROM users WHERE role='admin' LIMIT 1"):
            h = await asyncio.to_thread(security.hash_pw, settings.admin_password)
            await c.execute(
                "INSERT INTO users(email,password_hash,name,role,plan) VALUES($1,$2,'Admin','admin','premium') ON CONFLICT DO NOTHING",
                settings.admin_email.lower(), h,
            )
        if not await c.fetchval("SELECT 1 FROM models LIMIT 1"):
            await c.executemany(
                "INSERT INTO models(label,provider,model_id,premium_only) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
                DEFAULT_MODELS,
            )
        for k, v in DEFAULT_SETTINGS.items():
            await c.execute("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT DO NOTHING", k, v)


async def agency() -> dict:
    rows = await pool.fetch("SELECT key,value FROM settings WHERE key LIKE 'agency_%'")
    return {r["key"]: r["value"] for r in rows}


async def platform_key(provider: str) -> str:
    v = await pool.fetchval("SELECT value FROM settings WHERE key=$1", f"pk:{provider}")
    if v:
        return security.decrypt(v)
    return getattr(settings, f"{provider}_api_key", "")


async def platform_providers() -> set[str]:
    out = {p for p in PROVIDERS if getattr(settings, f"{p}_api_key", "")}
    rows = await pool.fetch("SELECT key FROM settings WHERE key LIKE 'pk:%'")
    return out | {r["key"][3:] for r in rows}
