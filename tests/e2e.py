"""Live end-to-end check against a running Postgres (pgvector). Fakes Voyage, Tavily and the LLM: no external keys needed.
Run: python -m tests.e2e   (with .env pointing at an EMPTY pgvector database)"""
import asyncio, hashlib, httpx
from app import rag, llm, deps
from app.main import app


async def fake_embed(texts, input_type):
    out = []
    for t in texts:  # deterministic bag-of-words hash vector: related text lands close together
        v = [0.0] * 1024
        for w in t.lower().split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 1024] += 1
        n = sum(x * x for x in v) ** 0.5 or 1
        out.append([x / n for x in v])
    return out


FAKE = {"say": ""}


async def fake_stream(provider, model, key, system, messages, max_tokens=700):
    FAKE["system"], FAKE["call"] = system, (provider, model, key)
    for part in ["Hello ", "from ", "the bot." + FAKE["say"]]:
        yield part


async def fake_web(query, n=4):
    return [{"title": "Paris weather", "url": "https://w.example/paris", "content": "Sunny tomorrow."}]

rag.embed, rag.web_search, llm.stream = fake_embed, fake_web, fake_stream


async def main():
    async with app.router.lifespan_context(app):
        c = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost:8000")
        H = lambda t: {"Authorization": "Bearer " + t}
        login = lambda e, p: c.post("/api/auth/login", json={"email": e, "password": p})
        r = await login("owner@test.dev", "owner-password-123"); assert r.status_code == 200, r.text
        adm = r.json()["token"]
        assert (await login("owner@test.dev", "nope")).status_code == 401
        await c.put("/api/admin/platform-keys/groq", json={"key": "gsk_test_platform_key"}, headers=H(adm))
        r = await c.put("/api/admin/settings", json={"agency_mode": "active", "agency_name": "Tawsif (TSMart)", "agency_site": "https://tawsif.dev", "agency_bio": "Builds AI.", "agency_works": "FlowWatch"}, headers=H(adm)); assert r.status_code == 200, r.text
        r = await c.post("/api/admin/clients", json={"email": "c1@x.com", "name": "C1", "password": "client-pass-1", "plan": "starter", "days": 30}, headers=H(adm)); assert r.status_code == 200, r.text
        assert (await c.post("/api/admin/clients", json={"email": "c2@x.com", "password": "client-pass-1", "plan": "owner"}, headers=H(adm))).status_code == 400
        tok = (await login("c1@x.com", "client-pass-1")).json()["token"]
        assert (await c.get("/api/admin/clients", headers=H(tok))).status_code == 403
        models = (await c.get("/api/models", headers=H(tok))).json()
        groq = next(m for m in models if m["provider"] == "groq")
        bid = (await c.post("/api/bots", json={"name": "Acme"}, headers=H(tok))).json()["id"]
        assert (await c.get(f"/api/bots/{bid}", headers=H(tok))).json()["model_id"] == groq["id"]  # default = a model that has a usable key
        assert (await c.post("/api/bots", json={"name": "Two"}, headers=H(tok))).status_code == 403  # starter: 1 bot
        assert (await c.patch(f"/api/bots/{bid}", json={"web_search": True}, headers=H(tok))).status_code == 403
        assert (await c.patch(f"/api/bots/{bid}", json={"agency_promo": False}, headers=H(tok))).status_code == 403
        r = await c.patch(f"/api/bots/{bid}", json={"model_id": groq["id"], "allowed_domains": ["https://www.acme.com/page"]}, headers=H(tok)); assert r.status_code == 200, r.text
        r = await c.post(f"/api/bots/{bid}/sources/text", json={"title": "Hours", "content": "Acme opens at nine am and closes at five pm every weekday. Refunds take seven days."}, headers=H(tok)); assert r.status_code == 200, r.text
        r = await c.post(f"/api/bots/{bid}/sources/file", files={"file": ("a.txt", b"Shipping is free for orders above fifty dollars in all regions.")}, headers=H(tok)); assert r.status_code == 200, r.text
        for bad in ["http://127.0.0.1:8000/", "http://169.254.169.254/latest", "http://user:pw@example.com/"]:
            assert (await c.post(f"/api/bots/{bid}/sources/url", json={"url": bad}, headers=H(tok))).status_code == 400, bad
        key = (await c.get(f"/api/bots/{bid}", headers=H(tok))).json()["public_key"]

        # widget config + origin rules
        cfgu = f"/api/public/config/{key}"
        assert (await c.get(cfgu, headers={"Origin": "https://acme.com"})).status_code == 200
        assert (await c.get(cfgu, headers={"Origin": "https://shop.acme.com"})).status_code == 200
        r = await c.get(cfgu, headers={"Origin": "https://evil.com"}); assert r.status_code == 403 and "evil.com" in r.json()["detail"] and "Allowed websites" in r.json()["detail"]
        assert (await c.get(cfgu)).status_code == 403  # allowlist set + no Origin/Referer (curl) -> refused
        assert (await c.get(cfgu, headers={"Sec-Fetch-Site": "same-origin"})).status_code == 200   # the dashboard's own /demo page (no Origin header on same-origin GET)
        assert (await c.get(cfgu, headers={"Origin": "http://localhost:8000"})).status_code == 200  # same host as the server
        assert (await c.get("/api/public/config/bot_nope", headers={"Origin": "https://acme.com"})).status_code == 404
        cfg = (await c.get(cfgu, headers={"Origin": "https://acme.com"})).json(); assert cfg["brand"]["name"] == "Tawsif (TSMart)"

        # install diagnostics
        hl = (await c.get(f"/api/bots/{bid}/health", headers=H(tok))).json()
        assert [x["status"] for x in hl][:3] == ["ok", "ok", "ok"], hl
        sc = (await c.post(f"/api/bots/{bid}/check-site", json={"url": "https://evil.com"}, headers=H(tok))).json()
        assert sc[0]["status"] == "fail" and "evil.com" in sc[0]["label"], sc
        sc = (await c.post(f"/api/bots/{bid}/check-site", json={"url": "http://127.0.0.1/"}, headers=H(tok))).json()
        assert any(x["label"].startswith("Could not open") for x in sc), sc

        # chat: retrieval + platform key + marketing block (turn 1: no promo yet)
        hdr = {"Origin": "https://acme.com"}
        chat = lambda msg, sess="sess-1234567", h=hdr: c.post("/api/public/chat", json={"bot": key, "session": sess, "message": msg}, headers=h)
        r = await chat("Acme opens at nine am every weekday?")
        assert r.status_code == 200 and "Hello" in r.text
        assert "opens at nine" in FAKE["system"] and "tawsif.dev" in FAKE["system"] and FAKE["call"][2] == "gsk_test_platform_key"
        assert "message number 1" in FAKE["system"]
        assert (await chat("hi", h={"Origin": "https://evil.com"})).status_code == 403
        # turn 2: model "mentions" the builder -> flagged -> never promoted again
        FAKE["say"] = " By the way this assistant was built by Tawsif, see tawsif.dev"
        await chat("And refunds take seven days?"); assert "message number 2" in FAKE["system"]
        FAKE["say"] = ""
        await chat("thanks"); assert "already mentioned" in FAKE["system"]
        convs = (await c.get(f"/api/bots/{bid}/conversations", headers=H(tok))).json(); assert convs[0]["n"] == 6
        me = (await c.get("/api/me", headers=H(tok))).json()
        assert me["usage"]["platform_msgs"] == 3 and me["usage"]["total_msgs"] == 3 and me["live"]

        # BYO key: unlimited platform quota, provider mismatch guard, total cap still counts
        await c.post("/api/keys", json={"provider": "openai", "label": "mine", "key": "sk-live-123456789"}, headers=H(tok))
        kid = (await c.get("/api/keys", headers=H(tok))).json()[0]["id"]
        assert (await c.patch(f"/api/bots/{bid}", json={"api_key_id": kid}, headers=H(tok))).status_code == 400
        gpt = next(m for m in models if m["model_id"] == "gpt-4o-mini")
        assert (await c.patch(f"/api/bots/{bid}", json={"model_id": gpt["id"], "api_key_id": kid}, headers=H(tok))).status_code == 200
        await chat("and refunds?", "sess-byo-0001")
        assert FAKE["call"] == ("openai", "gpt-4o-mini", "sk-live-123456789")
        me = (await c.get("/api/me", headers=H(tok))).json(); assert me["usage"]["platform_msgs"] == 3 and me["usage"]["total_msgs"] == 4

        # COST CAPS: total monthly cap applies even on the client's own key
        await deps.db.pool.execute("UPDATE usage SET total_msgs = 1500")
        r = await chat("one more?", "sess-cap-0001"); assert r.status_code == 429, r.text
        await deps.db.pool.execute("UPDATE usage SET total_msgs = 4")

        # admin disables the model -> falls back inside the key's provider; none left -> 503
        await c.patch(f"/api/admin/models/{gpt['id']}", json={"enabled": False}, headers=H(adm))
        assert (await chat("x", "sess-dis-0001")).status_code == 503
        await c.patch(f"/api/admin/models/{gpt['id']}", json={"enabled": True}, headers=H(adm))

        # premium: web search fires only on weak knowledge match, and is capped per month
        cid = (await c.get("/api/admin/clients", headers=H(adm))).json()[0]["id"]
        await c.patch(f"/api/admin/clients/{cid}", json={"plan": "premium"}, headers=H(adm))
        assert (await c.patch(f"/api/bots/{bid}", json={"web_search": True, "agency_promo": False}, headers=H(tok))).status_code == 200
        await chat("weather paris tomorrow sunny", "sess-web-0001"); assert "<WEB_RESULTS>" in FAKE["system"] and "ABOUT THE BUILDER" not in FAKE["system"]
        await chat("Acme opens at nine am every weekday?", "sess-web-0002"); assert "<WEB_RESULTS>" not in FAKE["system"]  # strong knowledge hit: no search spend
        await deps.db.pool.execute("UPDATE usage SET web_searches = 300")
        await chat("weather paris tomorrow sunny", "sess-web-0003"); assert "<WEB_RESULTS>" not in FAKE["system"]

        # expiry: chat + dashboard writes blocked, then renewed
        await c.patch(f"/api/admin/clients/{cid}", json={"expires_at": "2020-01-01T00:00:00Z"}, headers=H(adm))
        assert (await chat("x", "sess-exp-0001")).status_code == 403
        assert (await c.post(f"/api/bots/{bid}/sources/text", json={"title": "t", "content": "x" * 50}, headers=H(tok))).status_code == 402
        assert (await c.patch(f"/api/admin/clients/{cid}", json={"extend_days": 30}, headers=H(adm))).status_code == 200
        assert (await chat("x", "sess-exp-0002")).status_code == 200

        # conversations: delete
        convs = (await c.get(f"/api/bots/{bid}/conversations", headers=H(tok))).json()
        assert (await c.delete(f"/api/bots/{bid}/conversations/{convs[0]['id']}", headers=H(tok))).status_code == 200
        assert len((await c.get(f"/api/bots/{bid}/conversations", headers=H(tok))).json()) == len(convs) - 1

        # security: headers, body cap, legal pages, token revocation, lockout
        r = await c.get("/"); assert "script-src 'self'" in r.headers["content-security-policy"] and r.headers["x-content-type-options"] == "nosniff"
        assert (await c.get("/api/me", headers=H(tok))).headers["cache-control"] == "no-store"
        assert (await c.post("/api/auth/login", content=b"x" * 11_000_100, headers={"content-type": "application/json"})).status_code == 413
        assert "Privacy notice" in (await c.get("/privacy")).text and "Terms of service" in (await c.get("/terms")).text
        deps._hits.clear()
        r = await c.post("/api/me/password", json={"old": "client-pass-1", "new": "client-pass-2"}, headers=H(tok)); assert r.status_code == 200, r.text
        new_tok = r.json()["token"]
        assert (await c.get("/api/me", headers=H(tok))).status_code == 401      # old session revoked
        assert (await c.get("/api/me", headers=H(new_tok))).status_code == 200
        deps._hits.clear()
        for _ in range(8):
            deps._hits["login:" + "x"].clear()
            assert (await login("c1@x.com", "wrong-password")).status_code in (401, 429)
            deps._hits.pop("login:127.0.0.1", None); deps._hits.pop("login:?", None)
        deps._hits.pop("login:127.0.0.1", None); deps._hits.pop("login:?", None)
        assert (await login("c1@x.com", "client-pass-2")).status_code == 429     # locked even with the right password
        assert (await c.get("/api/admin/stats", headers=H(adm))).json()["bots"] == 1
        assert (await c.get("/")).status_code == 200 and (await c.get("/widget.js")).status_code == 200
        print("E2E PASSED")

asyncio.run(main())
