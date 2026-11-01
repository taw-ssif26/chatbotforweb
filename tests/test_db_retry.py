import os
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("FERNET_KEY", "wZl3hQ0xXfW3Qm0m0o3m8q7nTn1cC2Zl0m3J3kq0y9o=")
os.environ.setdefault("ADMIN_EMAIL", "a@b.c")
os.environ.setdefault("ADMIN_PASSWORD", "a-long-test-password")
import asyncio
import asyncpg
import pytest
from app.db import RetryPool


class Flaky:
    def __init__(self, fails, exc): self.fails, self.exc, self.calls = fails, exc, 0
    async def fetchval(self, *a): 
        self.calls += 1
        if self.calls <= self.fails: raise self.exc
        return 42


def test_retries_once_on_dead_connection():
    f = Flaky(1, asyncpg.ConnectionDoesNotExistError("connection was closed"))
    assert asyncio.run(RetryPool(f).fetchval("select 1")) == 42 and f.calls == 2


def test_gives_up_after_second_failure_and_never_retries_sql_errors():
    with pytest.raises(asyncpg.ConnectionDoesNotExistError):
        asyncio.run(RetryPool(Flaky(2, asyncpg.ConnectionDoesNotExistError("x"))).fetchval("select 1"))
    f = Flaky(1, asyncpg.UndefinedTableError("no such table"))
    with pytest.raises(asyncpg.UndefinedTableError):
        asyncio.run(RetryPool(f).fetchval("select 1"))
    assert f.calls == 1
