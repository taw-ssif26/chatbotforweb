import os

os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("FERNET_KEY", "wZl3hQ0xXfW3Qm0m0o3m8q7nTn1cC2Zl0m3J3kq0y9o=")
os.environ.setdefault("ADMIN_EMAIL", "a@b.c")
os.environ.setdefault("ADMIN_PASSWORD", "a-long-test-password")
import asyncio
import json

import httpx
import pytest

from app import emailer
from app.config import settings
from app.routes.client import needs_email_code


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(settings, "brevo_api_key", "xkeysib-test")
    monkeypatch.setattr(settings, "email_from", "noreply@example.com")
    monkeypatch.setattr(settings, "debug", False)


def test_mask():
    assert emailer.mask("alice@example.com") == "a***@example.com"


def test_brevo_request_shape(configured, monkeypatch):
    seen = {}

    def handler(req):
        seen.update(url=str(req.url), key=req.headers["api-key"], body=json.loads(req.content))
        return httpx.Response(201, json={"messageId": "x"})
    monkeypatch.setattr(emailer, "_client", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    asyncio.run(emailer.send("bob@x.com", "Hi", "Body"))
    assert seen["url"] == "https://api.brevo.com/v3/smtp/email" and seen["key"] == "xkeysib-test"
    assert seen["body"] == {"sender": {"name": "Chatbot Console", "email": "noreply@example.com"}, "to": [{"email": "bob@x.com"}],
                            "subject": "Hi", "textContent": "Body"}


def test_provider_errors_become_email_errors(configured, monkeypatch):
    monkeypatch.setattr(emailer, "_client", httpx.AsyncClient(transport=httpx.MockTransport(
        lambda r: httpx.Response(400, json={"message": "Sender not valid"}))))
    with pytest.raises(emailer.EmailError, match="400"):
        asyncio.run(emailer.send("bob@x.com", "Hi", "Body"))

    def boom(req):
        raise httpx.ConnectError("down")
    monkeypatch.setattr(emailer, "_client", httpx.AsyncClient(transport=httpx.MockTransport(boom)))
    with pytest.raises(emailer.EmailError, match="reach"):
        asyncio.run(emailer.send("bob@x.com", "Hi", "Body"))


def test_not_configured_fails_closed_unless_debug(monkeypatch):
    monkeypatch.setattr(settings, "brevo_api_key", "")
    monkeypatch.setattr(settings, "debug", False)
    assert not emailer.available()
    with pytest.raises(emailer.EmailError):
        asyncio.run(emailer.send("bob@x.com", "Hi", "Body"))
    monkeypatch.setattr(settings, "debug", True)
    assert emailer.available()
    asyncio.run(emailer.send("bob@x.com", "Hi", "Body"))   # logged, not sent


def test_who_needs_a_code(monkeypatch):
    monkeypatch.setattr(settings, "brevo_api_key", "")
    monkeypatch.setattr(settings, "debug", False)
    assert needs_email_code({"role": "client"}) is True        # clients always, even if email is down: fail closed
    assert needs_email_code({"role": "admin"}) is False        # owner has server access; no lock-out before email is set up
    monkeypatch.setattr(settings, "brevo_api_key", "k")
    monkeypatch.setattr(settings, "email_from", "a@b.c")
    assert needs_email_code({"role": "admin"}) is True
