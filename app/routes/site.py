"""Public marketing-site data, access requests (leads), and the owner's landing-page editor (contacts, offers, ads)."""
import json
import logging
import re
from datetime import UTC, datetime
from typing import Literal
from urllib.parse import quote, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

from .. import db, emailer
from ..config import settings
from ..deps import client_ip, limited, require_admin
from ..plans import PLANS

log = logging.getLogger("site")
public = APIRouter(prefix="/api/public")
admin = APIRouter(prefix="/api/admin", dependencies=[Depends(require_admin)])

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CONTACT_LABELS = {
    "email": "Email", "whatsapp": "WhatsApp", "telegram": "Telegram", "messenger": "Messenger", "phone": "Call",
    "linkedin": "LinkedIn", "instagram": "Instagram", "facebook": "Facebook", "fiverr": "Fiverr", "upwork": "Upwork",
    "github": "GitHub", "website": "Website", "other": "Other",
}
MAX_PROMOS = 12


def https_url(v: str) -> str | None:
    p = urlparse(v.strip())
    return v.strip() if p.scheme == "https" and p.hostname and not p.username else None


class ContactIn(BaseModel):
    type: str
    value: str = Field(min_length=1, max_length=200)
    label: str = Field(default="", max_length=40)


def contact_url(c: dict, wa_text: str) -> str | None:
    """Turn what the owner typed (a number, a handle, an address) into a safe link, or None if it isn't valid."""
    t, v = c["type"], c["value"].strip()
    if t == "email":
        return f"mailto:{v}" if EMAIL_RE.match(v) else None
    if t == "whatsapp":
        digits = re.sub(r"\D", "", v)
        return f"https://wa.me/{digits}?text={quote(wa_text)}" if 7 <= len(digits) <= 15 else None
    if t == "phone":
        digits = re.sub(r"[^\d+]", "", v)
        return f"tel:{digits}" if 7 <= len(re.sub(r"\D", "", digits)) <= 15 else None
    if t == "telegram":
        h = v.removeprefix("https://t.me/").lstrip("@")
        return f"https://t.me/{h}" if re.fullmatch(r"[A-Za-z0-9_]{3,32}", h) else None
    if t == "messenger":
        h = v.removeprefix("https://m.me/").removeprefix("https://www.messenger.com/t/")
        return f"https://m.me/{h}" if re.fullmatch(r"[A-Za-z0-9.]{3,64}", h) else None
    if t in CONTACT_LABELS:
        return https_url(v)
    return None


async def site_settings() -> dict:
    rows = await db.pool.fetch("SELECT key, value FROM settings WHERE key LIKE 'site\\_%'")
    return {r["key"]: r["value"] for r in rows}


def plan_features(p: dict) -> list[str]:
    f = [f"{p['bots']} chatbot{'s' if p['bots'] > 1 else ''}", f"Up to {p['sources']} knowledge sources",
         f"{p['total_msgs']:,} visitor messages a month", "Use your own AI keys, no message cap on them", "One-line install on any website"]
    if p["web_search"]:
        f.append("Live web search when your content has no answer")
    if p["premium_models"]:
        f.append("Premium AI models")
    if p["remove_branding"]:
        f.append("No “Powered by” footer")
    return f


PROMO_FIELDS = "id, kind, title, text, badge, price, old_price, image_url, link_url, cta_label, starts_at, ends_at, enabled, position"


async def site_data() -> dict:
    st, ag = await site_settings(), await db.agency()
    try:
        raw = json.loads(st.get("site_contacts", "[]"))
    except ValueError:
        raw = []
    wa = st.get("site_whatsapp_text", "")
    contacts = [{"type": c["type"], "label": c.get("label") or CONTACT_LABELS.get(c["type"], "Contact"), "url": u}
                for c in raw if (u := contact_url(c, wa))]
    promos = await db.pool.fetch(
        f"SELECT {PROMO_FIELDS} FROM promotions WHERE enabled AND (starts_at IS NULL OR starts_at <= now()) "  # noqa: S608  # nosec B608
        "AND (ends_at IS NULL OR ends_at > now()) ORDER BY position, id")
    promos = [dict(r) for r in promos]
    demo = None
    if st.get("site_demo_bot"):
        demo = await db.pool.fetchval(
            "SELECT b.public_key FROM bots b JOIN users u ON u.id=b.user_id WHERE b.public_key=$1 AND b.active AND u.role='admin'", st["site_demo_bot"])
    works = [w.strip() for w in ag.get("agency_works", "").splitlines() if w.strip()]
    return {
        "brand": {"name": ag.get("agency_name", ""), "bio": ag.get("agency_bio", ""), "site": ag.get("agency_site", ""), "works": works},
        "headline": st.get("site_headline", ""), "subheadline": st.get("site_subheadline", ""),
        "contacts": contacts,
        "plans": [{"id": k, "label": p["label"], "price": st.get(f"site_price_{k}", "").strip(), "features": plan_features(p)} for k, p in PLANS.items()],
        "bar": next((p for p in promos if p["kind"] == "bar"), None),
        "offers": [p for p in promos if p["kind"] == "offer"],
        "ads": [p for p in promos if p["kind"] == "ad"],
        "demo_bot": demo,
        "accounts_open": False,   # by design: the owner creates every account personally
        "links": {"app": "/app", "privacy": "/privacy", "terms": "/terms"},
    }


@public.get("/site")
async def get_site(request: Request, response: Response):
    if limited(f"site:{client_ip(request)}", 120):
        raise HTTPException(429, "Too many requests.")
    response.headers["Cache-Control"] = "public, max-age=30"
    return await site_data()


# ---------------- access requests ----------------
class LeadIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    contact: str = Field(min_length=3, max_length=200)
    message: str = Field(default="", max_length=1000)
    website: str = Field(default="", max_length=200)  # honeypot: real visitors never see this field


@public.post("/leads")
async def create_lead(body: LeadIn, request: Request, background: BackgroundTasks):
    if limited(f"lead:{client_ip(request)}", 3, 3600) or limited("lead:all", 40, 3600):
        raise HTTPException(429, "Too many requests. Please try again later, or message me directly.")
    if body.website:
        return {"ok": True}  # a bot filled the hidden field: pretend success, store nothing
    if len(re.findall(r"https?://", body.contact + " " + body.message)) > 2:
        raise HTTPException(400, "Please remove the links from your message.")
    await db.pool.execute("INSERT INTO leads(name, contact, message) VALUES($1,$2,$3)", body.name.strip(), body.contact.strip(), body.message.strip())
    if emailer.enabled():
        background.add_task(emailer.notify, settings.contact_email or settings.admin_email, "New access request",
                            f"Name: {body.name}\nContact: {body.contact}\n\n{body.message}\n\nOpen the dashboard: Owner → Requests.")
    return {"ok": True}


@admin.get("/leads")
async def list_leads():
    return [dict(r) for r in await db.pool.fetch("SELECT * FROM leads ORDER BY (status='new') DESC, created_at DESC LIMIT 300")]


class LeadPatch(BaseModel):
    status: Literal["new", "contacted", "done", "spam"]


@admin.patch("/leads/{lid}")
async def patch_lead(lid: int, body: LeadPatch):
    await db.pool.execute("UPDATE leads SET status=$1 WHERE id=$2", body.status, lid)
    return {"ok": True}


@admin.delete("/leads/{lid}")
async def delete_lead(lid: int):
    await db.pool.execute("DELETE FROM leads WHERE id=$1", lid)
    return {"ok": True}


# ---------------- offers, ads and the top bar ----------------
class PromoIn(BaseModel):
    kind: Literal["offer", "ad", "bar"]
    title: str = Field(min_length=1, max_length=120)
    text: str = Field(default="", max_length=400)
    badge: str = Field(default="", max_length=30)
    price: str = Field(default="", max_length=40)
    old_price: str = Field(default="", max_length=40)
    image_url: str = Field(default="", max_length=500)
    link_url: str = Field(default="", max_length=500)
    cta_label: str = Field(default="", max_length=40)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    enabled: bool = True

    @field_validator("image_url")
    @classmethod
    def _image(cls, v: str) -> str:
        if v and not https_url(v):
            raise ValueError("The image address must start with https://")
        return v.strip()

    @field_validator("link_url")
    @classmethod
    def _link(cls, v: str) -> str:
        v = v.strip()
        if v and not (https_url(v) or v.startswith("mailto:") or re.fullmatch(r"#[a-z-]{1,30}", v)):
            raise ValueError("The link must start with https://, mailto:, or be a section like #contact")
        return v


class PromoPatch(BaseModel):
    kind: Literal["offer", "ad", "bar"] | None = None
    title: str | None = Field(default=None, min_length=1, max_length=120)
    text: str | None = Field(default=None, max_length=400)
    badge: str | None = Field(default=None, max_length=30)
    price: str | None = Field(default=None, max_length=40)
    old_price: str | None = Field(default=None, max_length=40)
    image_url: str | None = Field(default=None, max_length=500)
    link_url: str | None = Field(default=None, max_length=500)
    cta_label: str | None = Field(default=None, max_length=40)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    enabled: bool | None = None

    _image = field_validator("image_url")(PromoIn._image.__func__)
    _link = field_validator("link_url")(PromoIn._link.__func__)


@admin.get("/promotions")
async def list_promos():
    return [dict(r) for r in await db.pool.fetch(f"SELECT {PROMO_FIELDS} FROM promotions ORDER BY kind, position, id")]  # noqa: S608  # nosec B608


@admin.post("/promotions")
async def create_promo(body: PromoIn):
    if await db.pool.fetchval("SELECT count(*) FROM promotions") >= MAX_PROMOS:
        raise HTTPException(400, f"You can keep up to {MAX_PROMOS} offers, ads and bars. Delete an old one first.")
    d = body.model_dump()
    pos = await db.pool.fetchval("SELECT coalesce(max(position), 0) + 1 FROM promotions")
    pid = await db.pool.fetchval(
        "INSERT INTO promotions(kind,title,text,badge,price,old_price,image_url,link_url,cta_label,starts_at,ends_at,enabled,position) "
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",
        d["kind"], d["title"].strip(), d["text"].strip(), d["badge"].strip(), d["price"].strip(), d["old_price"].strip(),
        d["image_url"], d["link_url"], d["cta_label"].strip(), d["starts_at"], d["ends_at"], d["enabled"], pos)
    return {"id": pid}


PROMO_COLUMNS = set(PromoPatch.model_fields)


@admin.patch("/promotions/{pid}")
async def patch_promo(pid: int, body: PromoPatch):
    d = {k: v for k, v in body.model_dump(exclude_unset=True).items() if v is not None or k in ("starts_at", "ends_at")}
    if d:
        assert set(d) <= PROMO_COLUMNS  # column names are interpolated below: never user text
        sets = ", ".join(f"{c}=${i + 2}" for i, c in enumerate(d))
        await db.pool.execute(f"UPDATE promotions SET {sets} WHERE id=$1", pid, *d.values())  # noqa: S608  # nosec B608
    return {"ok": True}


class MoveIn(BaseModel):
    direction: Literal["up", "down"]


@admin.post("/promotions/{pid}/move")
async def move_promo(pid: int, body: MoveIn):
    me = await db.pool.fetchrow("SELECT id, kind, position FROM promotions WHERE id=$1", pid)
    if not me:
        raise HTTPException(404, "Not found")
    op, order = ("<", "DESC") if body.direction == "up" else (">", "ASC")
    other = await db.pool.fetchrow(
        f"SELECT id, position FROM promotions WHERE kind=$1 AND (position {op} $2 OR (position = $2 AND id {op} $3)) ORDER BY position {order}, id {order} LIMIT 1",  # noqa: S608  # nosec B608
        me["kind"], me["position"], me["id"])
    if other:
        async with db.pool.acquire() as c, c.transaction():
            if other["position"] == me["position"]:  # equal positions: give them a distinct order first
                await c.execute("UPDATE promotions SET position = id WHERE kind=$1", me["kind"])
                me, other = (await c.fetchrow("SELECT id, position FROM promotions WHERE id=$1", me["id"]),
                             await c.fetchrow("SELECT id, position FROM promotions WHERE id=$1", other["id"]))
            await c.execute("UPDATE promotions SET position=$1 WHERE id=$2", other["position"], me["id"])
            await c.execute("UPDATE promotions SET position=$1 WHERE id=$2", me["position"], other["id"])
    return {"ok": True}


@admin.delete("/promotions/{pid}")
async def delete_promo(pid: int):
    await db.pool.execute("DELETE FROM promotions WHERE id=$1", pid)
    return {"ok": True}


# ---------------- landing content + contact channels ----------------
class SiteIn(BaseModel):
    site_headline: str = Field(max_length=140)
    site_subheadline: str = Field(max_length=300)
    site_price_starter: str = Field(default="", max_length=40)
    site_price_premium: str = Field(default="", max_length=40)
    site_whatsapp_text: str = Field(default="", max_length=200)
    site_demo_bot: str = Field(default="", max_length=64)
    site_contacts: list[ContactIn] = Field(default_factory=list, max_length=10)


@admin.get("/site")
async def get_site_admin():
    st = await site_settings()
    try:
        contacts = json.loads(st.get("site_contacts", "[]"))
    except ValueError:
        contacts = []
    bots = await db.pool.fetch("SELECT b.public_key, b.name FROM bots b JOIN users u ON u.id=b.user_id WHERE u.role='admin' ORDER BY b.id")
    return {"settings": {k: st.get(k, "") for k in SiteIn.model_fields if k != "site_contacts"}, "contacts": contacts,
            "types": CONTACT_LABELS, "bots": [dict(b) for b in bots]}


@admin.put("/site")
async def put_site(body: SiteIn):
    wa = body.site_whatsapp_text
    for i, c in enumerate(body.site_contacts, 1):
        if c.type not in CONTACT_LABELS:
            raise HTTPException(400, f"Contact {i}: unknown type")
        if not contact_url(c.model_dump(), wa):
            raise HTTPException(400, f"Contact {i} ({CONTACT_LABELS[c.type]}): “{c.value}” isn't valid. Use a full number with country code, a handle, an email, or an https:// link.")
    if body.site_demo_bot and not await db.pool.fetchval(
            "SELECT 1 FROM bots b JOIN users u ON u.id=b.user_id WHERE b.public_key=$1 AND u.role='admin'", body.site_demo_bot):
        raise HTTPException(400, "The demo bot must be one of your own bots.")
    values = body.model_dump(exclude={"site_contacts"}) | {"site_contacts": json.dumps([c.model_dump() for c in body.site_contacts])}
    for k, v in values.items():
        await db.pool.execute("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", k, v.strip() if isinstance(v, str) else v)
    return {"ok": True}


# ---------------- the design prompt ----------------
@admin.get("/landing-prompt")
async def landing_prompt(request: Request):
    from ..landing_prompt import build_prompt
    st, ag = await site_settings(), await db.agency()
    base = settings.public_base_url.rstrip("/") if settings.public_base_url.startswith("https://") else str(request.base_url).rstrip("/")
    return {"prompt": build_prompt(base, ag.get("agency_name", "the owner"), st.get("site_demo_bot", ""))}


_ = UTC  # imported for datetime-aware callers
