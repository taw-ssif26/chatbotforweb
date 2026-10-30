"""Client dashboard API: auth, account, API keys, bots, knowledge, conversations."""
import asyncio
import logging
import re
import secrets
from datetime import datetime, timezone
from urllib.parse import urlparse

import asyncpg
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from .. import db, llm, rag, security
from ..deps import client_ip, current_user, failures, forget, limited, live, record, require_live
from ..plans import plan_for

router = APIRouter(prefix="/api")
log = logging.getLogger("client")
HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
DUMMY_HASH = security.hash_pw("not-a-real-password")


# ---------------- auth / account ----------------
class LoginIn(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


@router.post("/auth/login")
async def login(body: LoginIn, request: Request):
    ip, email = client_ip(request), body.email.strip().lower()
    if limited(f"login:{ip}", 10) or failures(f"lf:{email}", 900) >= 8 or failures(f"lfip:{ip}", 900) >= 20:
        raise HTTPException(429, "Too many attempts. Try again in a few minutes.")
    u = await db.pool.fetchrow("SELECT * FROM users WHERE lower(email)=$1", email)
    ok = await security.check_pw(body.password, u["password_hash"] if u else DUMMY_HASH)
    if not u or not ok or not u["active"]:
        record(f"lf:{email}"); record(f"lfip:{ip}")
        raise HTTPException(401, "Wrong email or password, or the account is disabled.")
    forget(f"lf:{email}")
    return {"token": security.make_token(u["id"], u["token_version"])}


@router.get("/me")
async def me(u: dict = Depends(current_user)):
    plan = plan_for(u["role"], u["plan"])
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    use = await db.pool.fetchrow("SELECT platform_msgs,total_msgs,web_searches FROM usage WHERE user_id=$1 AND month=$2", u["id"], month)
    use = dict(use) if use else {"platform_msgs": 0, "total_msgs": 0, "web_searches": 0}
    nb = await db.pool.fetchval("SELECT count(*) FROM bots WHERE user_id=$1", u["id"])
    ns, chars = await db.pool.fetchrow(
        "SELECT count(*), coalesce(sum(s.chars),0) FROM sources s JOIN bots b ON b.id=s.bot_id WHERE b.user_id=$1", u["id"])
    return {
        "id": u["id"], "email": u["email"], "name": u["name"], "role": u["role"], "plan": u["plan"],
        "expires_at": u["expires_at"], "live": live(u["role"], u["active"], u["expires_at"]),
        "limits": plan, "usage": {**use, "bots": nb, "sources": ns, "chars": chars},
    }


class PwIn(BaseModel):
    old: str
    new: str = Field(min_length=8, max_length=200)


@router.post("/me/password")
async def change_password(body: PwIn, u: dict = Depends(current_user)):
    if not await security.check_pw(body.old, u["password_hash"]):
        raise HTTPException(400, "Current password is wrong")
    ver = await db.pool.fetchval(
        "UPDATE users SET password_hash=$1, token_version = token_version + 1 WHERE id=$2 RETURNING token_version",
        await security.hash_pw_async(body.new), u["id"])
    return {"token": security.make_token(u["id"], ver)}  # every other session is signed out


# ---------------- models + keys ----------------
@router.get("/models")
async def models(u: dict = Depends(current_user)):
    plan = plan_for(u["role"], u["plan"])
    have = await db.platform_providers()
    rows = await db.pool.fetch("SELECT id,label,provider,model_id,premium_only FROM models WHERE enabled ORDER BY provider, id")
    return [dict(r) | {"locked": r["premium_only"] and not plan["premium_models"], "included": r["provider"] in have} for r in rows]


class KeyIn(BaseModel):
    provider: str
    label: str = Field(min_length=1, max_length=60)
    key: str = Field(min_length=8, max_length=300)


@router.get("/keys")
async def list_keys(u: dict = Depends(current_user)):
    rows = await db.pool.fetch("SELECT id,provider,label,hint,created_at FROM api_keys WHERE user_id=$1 ORDER BY id", u["id"])
    return [dict(r) for r in rows]


@router.post("/keys")
async def add_key(body: KeyIn, u: dict = Depends(current_user)):
    if body.provider not in llm.PROVIDERS:
        raise HTTPException(400, "Unknown provider")
    if await db.pool.fetchval("SELECT count(*) FROM api_keys WHERE user_id=$1", u["id"]) >= 10:
        raise HTTPException(400, "Key limit reached (10)")
    k = body.key.strip()
    await db.pool.execute(
        "INSERT INTO api_keys(user_id,provider,label,key_enc,hint) VALUES($1,$2,$3,$4,$5)",
        u["id"], body.provider, body.label.strip(), security.encrypt(k), f"{k[:4]}…{k[-4:]}")
    return {"ok": True}


@router.delete("/keys/{kid}")
async def del_key(kid: int, u: dict = Depends(current_user)):
    await db.pool.execute("DELETE FROM api_keys WHERE id=$1 AND user_id=$2", kid, u["id"])
    return {"ok": True}


# ---------------- bots ----------------
async def own_bot(bid: int, u: dict):
    b = await db.pool.fetchrow("SELECT * FROM bots WHERE id=$1 AND user_id=$2", bid, u["id"])
    if not b:
        raise HTTPException(404, "Bot not found")
    return b


class BotIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


@router.get("/bots")
async def list_bots(u: dict = Depends(current_user)):
    rows = await db.pool.fetch(
        """SELECT b.id, b.name, b.public_key, b.active, m.label AS model_label,
                  (SELECT count(*) FROM sources s WHERE s.bot_id=b.id) AS source_count
           FROM bots b LEFT JOIN models m ON m.id=b.model_id WHERE b.user_id=$1 ORDER BY b.id""", u["id"])
    return [dict(r) for r in rows]


@router.post("/bots")
async def create_bot(body: BotIn, u: dict = Depends(require_live)):
    plan = plan_for(u["role"], u["plan"])
    if await db.pool.fetchval("SELECT count(*) FROM bots WHERE user_id=$1", u["id"]) >= plan["bots"]:
        raise HTTPException(403, f"Your plan allows {plan['bots']} bot(s)")
    mid = await db.pool.fetchval("SELECT id FROM models WHERE enabled AND NOT premium_only ORDER BY id LIMIT 1")
    name = body.name.strip()
    bid = await db.pool.fetchval(
        "INSERT INTO bots(user_id, public_key, name, system_prompt, model_id) VALUES($1,$2,$3,$4,$5) RETURNING id",
        u["id"], "bot_" + secrets.token_urlsafe(12), name,
        f"You are the friendly assistant for {name}. Help visitors with questions about the business, its products and services.", mid)
    return {"id": bid}


@router.get("/bots/{bid}")
async def get_bot(bid: int, u: dict = Depends(current_user)):
    return dict(await own_bot(bid, u))


class BotPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    welcome: str | None = Field(default=None, max_length=300)
    system_prompt: str | None = Field(default=None, max_length=4000)
    color: str | None = None
    position: str | None = None
    model_id: int | None = None
    api_key_id: int | None = None
    allowed_domains: list[str] | None = None
    web_search: bool | None = None
    agency_promo: bool | None = None
    active: bool | None = None


def norm_domain(d: str) -> str:
    d = d.strip().lower()
    host = urlparse(d if "://" in d else "//" + d).hostname or ""
    return host.removeprefix("www.")


@router.patch("/bots/{bid}")
async def patch_bot(bid: int, body: BotPatch, u: dict = Depends(require_live)):
    await own_bot(bid, u)
    plan = plan_for(u["role"], u["plan"])
    d = body.model_dump(exclude_unset=True)
    if "color" in d and not HEX.match(d["color"] or ""):
        raise HTTPException(400, "Color must look like #2f5bff")
    if "position" in d and d["position"] not in ("left", "right"):
        raise HTTPException(400, "Position must be left or right")
    if d.get("web_search") and not plan["web_search"]:
        raise HTTPException(403, "Web search is a Premium feature")
    if d.get("agency_promo") is False and not plan["remove_branding"]:
        raise HTTPException(403, "Turning off the builder mention is a Premium feature")
    if "allowed_domains" in d:
        d["allowed_domains"] = sorted({x for x in map(norm_domain, d["allowed_domains"] or []) if x})
    m = None
    if d.get("model_id"):
        m = await db.pool.fetchrow("SELECT * FROM models WHERE id=$1 AND enabled", d["model_id"])
        if not m or (m["premium_only"] and not plan["premium_models"]):
            raise HTTPException(403, "That model is not available on your plan")
    if d.get("api_key_id"):
        k = await db.pool.fetchrow("SELECT provider FROM api_keys WHERE id=$1 AND user_id=$2", d["api_key_id"], u["id"])
        if not k:
            raise HTTPException(400, "Unknown API key")
        cur_model = m or await db.pool.fetchrow(
            "SELECT m.* FROM models m JOIN bots b ON b.model_id=m.id WHERE b.id=$1", bid)
        if not cur_model or cur_model["provider"] != k["provider"]:
            raise HTTPException(400, f"That key is for {k['provider']}. Pick a {k['provider']} model for this bot.")
    elif "api_key_id" not in d and m:
        # switching models while a key is attached: provider must still match
        kp = await db.pool.fetchval("SELECT k.provider FROM api_keys k JOIN bots b ON b.api_key_id=k.id WHERE b.id=$1", bid)
        if kp and kp != m["provider"]:
            raise HTTPException(400, f"This bot uses your {kp} key. Pick a {kp} model or remove the key first.")
    if not d:
        return {"ok": True}
    cols = list(d)
    sets = ", ".join(f"{c}=${i + 2}" for i, c in enumerate(cols))
    await db.pool.execute(f"UPDATE bots SET {sets} WHERE id=$1", bid, *[d[c] for c in cols])
    return {"ok": True}


@router.delete("/bots/{bid}")
async def delete_bot(bid: int, u: dict = Depends(current_user)):
    await own_bot(bid, u)
    await db.pool.execute("DELETE FROM bots WHERE id=$1", bid)
    return {"ok": True}


# ---------------- knowledge ----------------
async def ingest(u: dict, bot, kind: str, title: str, text: str):
    plan = plan_for(u["role"], u["plan"])
    text = rag.clean(text)
    if len(text) < 20:
        raise HTTPException(400, "No readable text found (pages rendered by JavaScript can't be read; paste the text instead)")
    if len(text) > 300_000:
        raise HTTPException(400, "Too large: 300,000 characters max per source")
    n, chars = await db.pool.fetchrow(
        "SELECT count(*), coalesce(sum(s.chars),0) FROM sources s JOIN bots b ON b.id=s.bot_id WHERE b.user_id=$1", u["id"])
    if n >= plan["sources"] or chars + len(text) > plan["max_chars"]:
        raise HTTPException(403, "Knowledge limit reached for your plan. Delete a source or upgrade.")
    chunks = rag.chunk_text(text)
    try:
        vecs = await rag.embed([f"{title}\n{c}" for c in chunks], "document")
    except Exception:
        log.exception("embedding failed")
        raise HTTPException(503, "Could not index this content right now. Please try again in a minute.")
    async with db.pool.acquire() as c, c.transaction():
        sid = await c.fetchval(
            "INSERT INTO sources(bot_id, kind, title, chars) VALUES($1,$2,$3,$4) RETURNING id",
            bot["id"], kind, title[:200], len(text))
        await c.executemany(
            "INSERT INTO chunks(source_id, bot_id, content, embedding) VALUES($1,$2,$3,$4)",
            [(sid, bot["id"], ch, v) for ch, v in zip(chunks, vecs)])
    return {"id": sid, "chunks": len(chunks)}


@router.get("/bots/{bid}/sources")
async def list_sources(bid: int, u: dict = Depends(current_user)):
    await own_bot(bid, u)
    rows = await db.pool.fetch("SELECT id,kind,title,chars,created_at FROM sources WHERE bot_id=$1 ORDER BY id DESC", bid)
    return [dict(r) for r in rows]


class TextIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=300_000)


class UrlIn(BaseModel):
    url: str = Field(max_length=2000)


@router.post("/bots/{bid}/sources/text")
async def add_text(bid: int, body: TextIn, u: dict = Depends(require_live)):
    return await ingest(u, await own_bot(bid, u), "text", body.title.strip(), body.content)


@router.post("/bots/{bid}/sources/url")
async def add_url(bid: int, body: UrlIn, u: dict = Depends(require_live)):
    bot = await own_bot(bid, u)
    if limited(f"fetch:{u['id']}", 10):
        raise HTTPException(429, "Slow down: 10 URL imports per minute")
    try:
        title, text = await rag.fetch_url(body.url.strip())
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception:
        raise HTTPException(400, "Could not fetch that URL")
    return await ingest(u, bot, "url", title, text)


@router.post("/bots/{bid}/sources/file")
async def add_file(bid: int, file: UploadFile = File(...), u: dict = Depends(require_live)):
    bot = await own_bot(bid, u)
    data = await file.read(10_000_001)
    if len(data) > 10_000_000:
        raise HTTPException(400, "File too large (10 MB max)")
    name = file.filename or "file"
    ext = name.lower().rsplit(".", 1)[-1]
    if ext == "pdf":
        try:
            text = await asyncio.to_thread(rag.pdf_to_text, data)
        except Exception:
            raise HTTPException(400, "Could not read this PDF")
    elif ext in ("txt", "md", "csv", "json", "html", "htm"):
        raw = data.decode("utf-8", "replace")
        text = rag.html_to_text(raw)[1] if ext in ("html", "htm") else raw
    else:
        raise HTTPException(400, "Supported files: PDF, TXT, MD, CSV, JSON, HTML")
    return await ingest(u, bot, "file", name, text)


@router.delete("/sources/{sid}")
async def del_source(sid: int, u: dict = Depends(current_user)):
    await db.pool.execute(
        "DELETE FROM sources s USING bots b WHERE s.id=$1 AND s.bot_id=b.id AND b.user_id=$2", sid, u["id"])
    return {"ok": True}


# ---------------- conversations ----------------
@router.get("/bots/{bid}/conversations")
async def conversations(bid: int, u: dict = Depends(current_user)):
    await own_bot(bid, u)
    rows = await db.pool.fetch(
        """SELECT c.id, c.last_at,
                  (SELECT count(*) FROM messages m WHERE m.conversation_id=c.id) AS n,
                  (SELECT content FROM messages m WHERE m.conversation_id=c.id AND role='user' ORDER BY id LIMIT 1) AS first
           FROM conversations c WHERE c.bot_id=$1 ORDER BY c.last_at DESC LIMIT 50""", bid)
    return [dict(r) for r in rows]


@router.get("/bots/{bid}/conversations/{cid}")
async def conversation(bid: int, cid: int, u: dict = Depends(current_user)):
    await own_bot(bid, u)
    rows = await db.pool.fetch(
        "SELECT m.role, m.content, m.created_at FROM messages m JOIN conversations c ON c.id=m.conversation_id "
        "WHERE c.id=$1 AND c.bot_id=$2 ORDER BY m.id", cid, bid)
    return [dict(r) for r in rows]


@router.delete("/bots/{bid}/conversations/{cid}")
async def delete_conversation(bid: int, cid: int, u: dict = Depends(current_user)):
    await own_bot(bid, u)
    await db.pool.execute("DELETE FROM conversations WHERE id=$1 AND bot_id=$2", cid, bid)
    return {"ok": True}
