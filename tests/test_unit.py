import os
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("FERNET_KEY", "wZl3hQ0xXfW3Qm0m0o3m8q7nTn1cC2Zl0m3J3kq0y9o=")
os.environ.setdefault("ADMIN_EMAIL", "a@b.c")
os.environ.setdefault("ADMIN_PASSWORD", "a-long-test-password")
import asyncio
import pytest
from app import rag
from app.routes.public import normalize


def test_chunking_bounds_and_coverage():
    text = "\n\n".join(f"Paragraph {i} " + "word " * 120 for i in range(10)) + "\n\n" + "x" * 3000
    chunks = rag.chunk_text(text)
    assert all(0 < len(c) <= 1000 for c in chunks)
    assert "Paragraph 9" in "".join(chunks)


def test_normalize_alternates_and_starts_with_user():
    out = normalize([{"role": "assistant", "content": "a"}, {"role": "user", "content": "b"}, {"role": "user", "content": "c"}], "d")
    assert [m["role"] for m in out] == ["user"]
    assert out[0]["content"] == "b\nc\nd"


@pytest.mark.parametrize("url", ["http://127.0.0.1/", "http://localhost:8000", "http://169.254.169.254/latest", "ftp://example.com"])
def test_ssrf_blocked(url):
    with pytest.raises(ValueError):
        asyncio.run(rag._assert_public(url))


def test_promo_block_modes():
    from app.routes.public import mentions_builder, promo_block
    bot = {"agency_promo": True}
    ag = {"agency_name": "Tawsif (TSMart)", "agency_site": "https://tawsif.dev", "agency_bio": "Builds AI.", "agency_mode": "active"}
    assert "message number 3" in promo_block(bot, ag, False, 3)
    assert "already mentioned" in promo_block(bot, ag, True, 3)
    assert "Never bring the builder up otherwise" in promo_block(bot, {**ag, "agency_mode": "ask"}, False, 3)
    assert promo_block({"agency_promo": False}, ag, False, 3) == ""
    assert mentions_builder("built by Tawsif, see tawsif.dev", ag) and not mentions_builder("hello", ag)
