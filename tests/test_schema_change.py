"""Reproduces the production failure: a deploy adds a column while running connections have a cached SELECT * plan.
Needs a Postgres: TEST_DATABASE_URL=postgresql://... pytest tests/test_schema_change.py"""
import os
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("FERNET_KEY", "wZl3hQ0xXfW3Qm0m0o3m8q7nTn1cC2Zl0m3J3kq0y9o=")
os.environ.setdefault("ADMIN_EMAIL", "a@b.c")
os.environ.setdefault("ADMIN_PASSWORD", "a-long-test-password")
import asyncio
import asyncpg
import pytest

URL = os.environ.get("TEST_DATABASE_URL")


@pytest.mark.skipif(not URL, reason="set TEST_DATABASE_URL to run")
def test_running_pool_survives_a_schema_change():
    from app import db

    async def alter(sql):
        c = await asyncpg.connect(URL)
        await c.execute(sql)
        await c.close()

    async def go():
        await alter("DROP TABLE IF EXISTS scratch_cache; CREATE TABLE scratch_cache(id int primary key, a text); INSERT INTO scratch_cache VALUES (1,'x')")
        q = "SELECT * FROM scratch_cache WHERE id=$1"
        # 1. with asyncpg defaults (statement cache on) the production error escapes whenever the query runs inside a
        #    transaction (asyncpg only auto-retries outside one; poolers like Neon's -pooler endpoint behave the same way)
        raw = await asyncpg.create_pool(URL, min_size=1, max_size=1)
        async with raw.acquire() as c:
            await c.fetchrow(q, 1)
            await alter("ALTER TABLE scratch_cache ADD COLUMN b text")
            with pytest.raises(asyncpg.exceptions.InvalidCachedStatementError):
                async with c.transaction():
                    await c.fetchrow(q, 1)
        await raw.close()
        # 2. the app's pool: no statement cache, so a schema change can never leave a stale plan behind
        pool = await db.make_pool(URL)
        async with pool.acquire() as c:
            async with c.transaction():
                await c.fetchrow(q, 1)
            await alter("ALTER TABLE scratch_cache ADD COLUMN c text")
            async with c.transaction():
                assert "c" in (await c.fetchrow(q, 1)).keys()
        assert "c" in (await pool.fetchrow(q, 1)).keys()
        await pool.close()
        await alter("DROP TABLE scratch_cache")

    asyncio.run(go())


def test_retry_pool_also_retries_stale_plans():
    from app.db import RetryPool

    class Stale:
        calls = 0
        async def fetchrow(self, *a):
            self.calls += 1
            if self.calls == 1:
                raise asyncpg.exceptions.InvalidCachedStatementError("cached statement plan is invalid due to a database schema or configuration change")
            return {"ok": True}
    s = Stale()
    assert asyncio.run(RetryPool(s).fetchrow("select 1")) == {"ok": True} and s.calls == 2
