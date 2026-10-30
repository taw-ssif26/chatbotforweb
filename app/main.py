import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from . import db, legal, llm, rag
from .config import settings

log = logging.getLogger("app")
STATIC = Path(__file__).parent / "static"
MAX_BODY = 11_000_000  # file uploads are capped at 10 MB in the handler; everything else is far smaller

if settings.sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(dsn=settings.sentry_dsn, send_default_pii=False, traces_sample_rate=0)


async def retention_loop() -> None:
    while True:
        try:
            await db.pool.execute("DELETE FROM conversations WHERE last_at < now() - make_interval(days => $1)", settings.retention_days)
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
    await db.close()


class SecurityMiddleware:
    """Pure ASGI (no response buffering, so SSE streams untouched): size cap + security headers."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        try:
            too_big = int(headers.get(b"content-length", b"0")) > MAX_BODY
        except ValueError:
            too_big = True
        if too_big:
            await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json")]})
            return await send({"type": "http.response.body", "body": b'{"detail":"Request too large"}'})
        path = scope["path"]
        https = scope.get("scheme") == "https" or headers.get(b"x-forwarded-proto") == b"https"

        async def send_wrapped(msg):
            if msg["type"] == "http.response.start":
                h = msg.setdefault("headers", [])
                have = {k.lower() for k, _ in h}
                extra = [(b"x-content-type-options", b"nosniff"), (b"referrer-policy", b"no-referrer")]
                if https:
                    extra.append((b"strict-transport-security", b"max-age=31536000"))
                if path.startswith("/api/") and not path.startswith("/api/public/"):
                    extra.append((b"cache-control", b"no-store"))
                h.extend(x for x in extra if x[0] not in have)
            await send(msg)

        await self.app(scope, receive, send_wrapped)


app = FastAPI(
    title="Embeddable Chatbot", lifespan=lifespan,
    docs_url="/docs" if settings.debug else None, redoc_url=None, openapi_url="/openapi.json" if settings.debug else None,
)
# Auth is a Bearer header (no cookies), so open CORS is safe; per-bot domain allowlists protect the widget endpoints.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], max_age=3600)
app.add_middleware(SecurityMiddleware)

from .routes import admin, client, public  # noqa: E402

app.include_router(public.router)
app.include_router(client.router)
app.include_router(admin.router)
app.mount("/static", StaticFiles(directory=STATIC), name="static")

DASH_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    "Cache-Control": "no-cache",
}


@app.get("/", include_in_schema=False)
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
    return HTMLResponse(legal.privacy())


@app.get("/terms", include_in_schema=False)
async def terms():
    return HTMLResponse(legal.terms())


@app.get("/healthz", include_in_schema=False)
async def healthz():
    return {"ok": True}  # deliberately no DB call: a keep-alive pinger must not keep a serverless DB awake
