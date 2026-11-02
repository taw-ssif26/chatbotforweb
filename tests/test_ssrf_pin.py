"""The URL importer must connect to the IP it validated and send the original Host header."""
import os
os.environ.setdefault("DATABASE_URL", "postgresql://x:x@localhost/x")
os.environ.setdefault("JWT_SECRET", "x" * 40)
os.environ.setdefault("FERNET_KEY", "wZl3hQ0xXfW3Qm0m0o3m8q7nTn1cC2Zl0m3J3kq0y9o=")
os.environ.setdefault("ADMIN_EMAIL", "a@b.c")
os.environ.setdefault("ADMIN_PASSWORD", "a-long-test-password")
import asyncio
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import pytest
from app import rag

SEEN = {}


class H(BaseHTTPRequestHandler):
    def do_GET(self):
        SEEN["host"] = self.headers.get("Host")
        if self.path == "/redir":
            self.send_response(302); self.send_header("Location", "http://169.254.169.254/x"); self.end_headers(); return
        body = b"<html><title>Hi</title><body><p>Opening hours are nine to five on weekdays.</p></body></html>"
        self.send_response(200); self.send_header("Content-Type", "text/html"); self.end_headers(); self.wfile.write(body)
    def log_message(self, *a): pass


def test_pinned_fetch_and_redirect_revalidation(monkeypatch):
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    port = srv.server_address[1]
    monkeypatch.setattr(rag, "ALLOWED_PORTS", (port,))
    monkeypatch.setattr(rag, "_ip_ok", lambda ip: ip.is_loopback)  # allow only loopback for this test
    title, text = asyncio.run(rag.fetch_url(f"http://localhost:{port}/"))
    assert title == "Hi" and "nine to five" in text and SEEN["host"] == f"localhost:{port}"
    with pytest.raises(ValueError):  # redirect to a metadata IP is re-validated and rejected
        asyncio.run(rag.fetch_url(f"http://localhost:{port}/redir"))
    srv.shutdown()


def test_credentials_and_ports_rejected():
    for u in ["http://user:pw@example.com/", "http://example.com:6379/"]:
        with pytest.raises(ValueError):
            asyncio.run(rag._assert_public(u))
