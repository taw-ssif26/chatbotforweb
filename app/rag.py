"""Ingestion (chunk, embed, fetch URLs safely) and retrieval (Voyage + Tavily)."""
import asyncio
import io
import ipaddress
import re
import socket
from collections import OrderedDict
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

from .config import settings

http = httpx.AsyncClient(timeout=20)


def chunk_text(text: str, size: int = 900, overlap: int = 120) -> list[str]:
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    cur = ""
    for p in paras:
        while len(p) > size:  # hard-split oversized paragraphs, with overlap
            if cur:
                chunks.append(cur)
                cur = ""
            cut = p.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            chunks.append(p[:cut])
            p = p[cut - overlap:]
        if len(cur) + len(p) + 2 <= size:
            cur = f"{cur}\n\n{p}" if cur else p
        else:
            if cur:
                chunks.append(cur)
            cur = p
    if cur:
        chunks.append(cur)
    return chunks


def clean(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


_qcache: OrderedDict[str, list[float]] = OrderedDict()  # repeated visitor questions cost nothing


async def embed(texts: list[str], input_type: str) -> list[list[float]]:
    if not settings.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set on the server")
    if input_type == "query" and len(texts) == 1 and texts[0] in _qcache:
        _qcache.move_to_end(texts[0])
        return [_qcache[texts[0]]]
    out: list[list[float]] = []
    for i in range(0, len(texts), 64):
        r = await http.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {settings.voyage_api_key}"},
            json={"input": texts[i:i + 64], "model": settings.voyage_model, "input_type": input_type, "output_dimension": 1024},
        )
        if r.status_code != 200:
            raise RuntimeError(f"Voyage error {r.status_code}: {r.text[:200]}")
        out += [d["embedding"] for d in r.json()["data"]]
    if input_type == "query" and len(texts) == 1:
        _qcache[texts[0]] = out[0]
        if len(_qcache) > 512:
            _qcache.popitem(last=False)
    return out


async def web_search(query: str, n: int = 4) -> list[dict]:
    if not settings.tavily_api_key:
        return []
    r = await http.post(
        "https://api.tavily.com/search",
        headers={"Authorization": f"Bearer {settings.tavily_api_key}"},
        json={"query": query[:300], "max_results": n, "search_depth": "basic"},
    )
    r.raise_for_status()
    return [{"title": x["title"], "url": x["url"], "content": x["content"][:700]} for x in r.json().get("results", [])]


# ---------- safe URL fetching (SSRF guard) ----------
ALLOWED_PORTS = (80, 443)


def _ip_ok(ip: ipaddress._BaseAddress) -> bool:
    return ip.is_global


async def _resolve_public(url: str):
    """Validate the URL and return (parsed, ip). The request is then pinned to that IP, so DNS rebinding can't swap it."""
    p = urlparse(url)
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Enter a full http(s) URL")
    port = p.port or (443 if p.scheme == "https" else 80)
    if port not in ALLOWED_PORTS:
        raise ValueError("Only standard web ports (80, 443) are allowed")
    infos = await asyncio.get_running_loop().getaddrinfo(p.hostname, port, type=socket.SOCK_STREAM)
    ips = [ipaddress.ip_address(i[4][0]) for i in infos]
    if not ips or not all(_ip_ok(ip) for ip in ips):
        raise ValueError("That address is not allowed")
    return p, port, str(ips[0])


async def _assert_public(url: str) -> None:  # kept for tests
    await _resolve_public(url)


def html_to_text(html: str) -> tuple[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    title = (soup.title.string or "").strip() if soup.title else ""
    for t in soup(["script", "style", "nav", "footer", "header", "noscript", "svg", "form", "iframe"]):
        t.decompose()
    return title, clean(soup.get_text("\n"))


def pdf_to_text(data: bytes) -> str:
    return clean("\n\n".join((pg.extract_text() or "") for pg in PdfReader(io.BytesIO(data)).pages))


async def fetch_url(url: str) -> tuple[str, str]:
    """Returns (title, text). <=4 redirects, each re-validated and IP-pinned; body capped at 2 MB."""
    async with httpx.AsyncClient(timeout=15, follow_redirects=False, headers={"User-Agent": "ChatbotIngest/1.0"}) as c:
        for _ in range(5):
            p, port, ip = await _resolve_public(url)
            host = f"[{ip}]" if ":" in ip else ip
            pinned = p._replace(netloc=f"{host}:{port}").geturl()
            host_header = p.hostname + (f":{p.port}" if p.port else "")
            async with c.stream("GET", pinned, headers={"Host": host_header}, extensions={"sni_hostname": p.hostname}) as r:
                if r.is_redirect:
                    url = urljoin(url, r.headers.get("location", ""))
                    continue
                if r.status_code >= 400:
                    raise ValueError(f"The site returned HTTP {r.status_code}")
                body = b""
                async for part in r.aiter_bytes():
                    body += part
                    if len(body) > 2_000_000:
                        break
                ctype = r.headers.get("content-type", "")
                if "pdf" in ctype:
                    return url, await asyncio.to_thread(pdf_to_text, body)
                if "html" in ctype:
                    title, text = await asyncio.to_thread(html_to_text, body.decode(r.encoding or "utf-8", "replace"))
                    return title or url, text
                return url, clean(body.decode("utf-8", "replace"))
    raise ValueError("Too many redirects")
