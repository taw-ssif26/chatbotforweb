import asyncio
import logging
from html import escape
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, emailer, errors, legal, llm, rag
from .config import settings

log = logging.getLogger("app")
STATIC = Path(__file__).parent / "static"
MAX_BODY = 11_000_000  # file uploads are capped at 10 MB in the handler; everything else is far smaller

if settings.sentry_dsn:
    import sentry_sdk
    # Never ship request bodies (they contain chat text and API keys) or local variables to a third party.
    sentry_sdk.init(dsn=settings.sentry_dsn, send_default_pii=False, traces_sample_rate=0,
                    max_request_body_size="never", include_local_variables=False)


async def retention_loop() -> None:
    while True:
        try:
            await db.pool.execute("DELETE FROM conversations WHERE last_at < now() - make_interval(days => $1)", settings.retention_days)
            await db.pool.execute("DELETE FROM email_codes WHERE expires_at < now() - interval '1 day'")
            await db.pool.execute("DELETE FROM usage WHERE month < to_char(now() - interval '13 months', 'YYYY-MM')")
        except Exception:
            log.exception("retention job failed")
        await asyncio.sleep(6 * 3600)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    await db.seed()
    task = asyncio.create_task(retention_loop())
    yield
    task.cancel()
    await llm.client.aclose()
    await rag.http.aclose()
    await emailer._client.aclose()
    await db.close()


class SecurityMiddleware:
    """Pure ASGI (no response buffering, so SSE streams untouched): request size cap (also for chunked bodies) + security headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await self._reject(send, 400, b'{"detail":"Bad request"}')
        if declared > MAX_BODY:
            return await self._reject(send, 413, b'{"detail":"Request too large"}')
        path = scope["path"]
        https = scope.get("scheme") == "https" or headers.get(b"x-forwarded-proto") == b"https"
        received, rejected = 0, False

        async def counted_receive():
            nonlocal received, rejected
            msg = await receive()
            if msg["type"] == "http.request" and not rejected:
                received += len(msg.get("body", b""))
                if received > MAX_BODY:  # chunked upload without a Content-Length: answer 413 now, tell the app the client is gone
                    rejected = True
                    await self._reject(send, 413, b'{"detail":"Request too large"}')
                    return {"type": "http.disconnect"}
            return msg

        async def send_wrapped(msg):
            if rejected:
                return
            if msg["type"] == "http.response.start":
                h = msg.setdefault("headers", [])
                have = {k.lower() for k, _ in h}
                extra = [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"strict-origin-when-cross-origin")]
                if https:
                    extra.append((b"strict-transport-security", b"max-age=31536000"))
                if path.startswith("/api/") and not path.startswith("/api/public/"):
                    extra.append((b"cache-control", b"no-store"))
                h.extend(x for x in extra if x[0] not in have)
            await send(msg)

        await self.app(scope, counted_receive, send_wrapped)

    @staticmethod
    async def _reject(send, status: int, body: bytes):
        await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json")]})
        await send({"type": "http.response.body", "body": body})


app = FastAPI(
    title="Embeddable Chatbot", lifespan=lifespan,
    docs_url="/docs" if settings.debug else None, redoc_url=None, openapi_url="/openapi.json" if settings.debug else None,
)
# Auth is a Bearer header (no cookies), so open CORS is safe; per-bot domain allowlists protect the widget endpoints.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], max_age=3600)
app.add_middleware(SecurityMiddleware)

from .routes import admin, client, public, site  # noqa: E402


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    ref = errors.record(request, exc)
    return JSONResponse({"detail": f"Server error (reference {ref}). The owner can see the details under Owner → Status."}, status_code=500)



app.include_router(public.router)
app.include_router(client.router)
app.include_router(admin.router)
app.include_router(site.public)
app.include_router(site.admin)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

DASH_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Cache-Control": "no-cache", "Referrer-Policy": "no-referrer",
}


LEGAL_HEADERS = {"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'self'"}


LANDING_HTML = (STATIC / "landing.html").read_text()
LANDING_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; "
                               "object-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
    "Cache-Control": "public, max-age=30",
}


@app.get("/", include_in_schema=False)
async def landing():
    """Public landing page. Headline, brand and meta tags are filled in on the server so the first paint (and search engines) see real text."""
    d = await site.site_data()
    brand = d["brand"]["name"] or "AI Chatbot"
    html = (LANDING_HTML.replace("{{TITLE}}", escape(f"{brand}: AI chatbot for any website"))
            .replace("{{DESCRIPTION}}", escape(d["subheadline"][:155])).replace("{{HEADLINE}}", escape(d["headline"]))
            .replace("{{SUBHEADLINE}}", escape(d["subheadline"])).replace("{{BRAND}}", escape(brand)))
    return HTMLResponse(html, headers=LANDING_HEADERS)


@app.get("/app", include_in_schema=False)
async def dashboard():
    return FileResponse(STATIC / "index.html", headers=DASH_HEADERS)


@app.get("/widget.js", include_in_schema=False)
async def widget():
    return FileResponse(STATIC / "widget.js", media_type="application/javascript", headers={"Cache-Control": "public, max-age=300"})


@app.get("/demo", include_in_schema=False)
async def demo():
    return FileResponse(STATIC / "demo.html")


@app.get("/privacy", include_in_schema=False)
async def privacy():
    return HTMLResponse(legal.privacy(), headers=LEGAL_HEADERS)


@app.get("/terms", include_in_schema=False)
async def terms():
    return HTMLResponse(legal.terms(), headers=LEGAL_HEADERS)


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {"ok": True}  # deliberately no DB call: a keep-alive pinger must not keep a serverless DB awake
