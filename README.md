# Embeddable AI Chatbot SaaS

One FastAPI service = API + client dashboard + owner dashboard + the embeddable widget.

## Run locally
```bash
cp .env.example .env     # fill JWT_SECRET, FERNET_KEY (commands inside), ADMIN_*, VOYAGE_API_KEY, at least one LLM key
docker compose up --build
# open http://localhost:8000 and sign in with ADMIN_EMAIL / ADMIN_PASSWORD
```
Without Docker: run Postgres with the pgvector extension, set `DATABASE_URL`, then `pip install -r requirements.txt && uvicorn app.main:app --reload`.

## Deploy on Railway
1. New project -> add the **pgvector** Postgres template (plain Railway Postgres does not ship the extension).
2. Add this repo as a service (Dockerfile is detected). Set variables from `.env.example`; `DATABASE_URL` = the Postgres reference variable; `PUBLIC_BASE_URL` = your Railway/custom domain with https.
3. Open the domain, sign in as admin. Tables and default models are created on first boot.

## Your workflow
1. **Settings**: fill your marketing profile (site + works) and add platform LLM keys.
2. **Clients -> Add a client** after they pay. **Paid +30 days** each month. **Disable** to cut access instantly.
3. **Models**: enable/disable models, mark premium-only, add new model IDs without redeploying.
4. Client logs in, adds knowledge, picks a model, copies the one-line snippet.

## Embed (what clients paste before `</body>`)
```html
<script src="https://YOUR-DOMAIN/widget.js" data-bot="BOT_KEY" async></script>
```
Shadow DOM isolates styles. Test any bot at `/demo?bot=BOT_KEY`.

## What protects your bill and your clients
- **Monthly caps per client** (`app/plans.py`): total visitor messages (each costs you a Voyage embedding, even on the client's own key), messages on your platform LLM keys, and web searches. Enforced atomically in one SQL statement.
- Repeated questions reuse a cached embedding; web search runs only when the knowledge match is weak.
- Per-IP, per-session and per-bot rate limits; login lockout per account and per IP; tokens expire in 3 days and die on password change.
- URL import is SSRF-hardened: public IPs only, ports 80/443, connection pinned to the validated IP, redirects re-checked.
- Dashboard runs under a strict CSP; all dynamic text is escaped; API keys are Fernet-encrypted; startup refuses weak `JWT_SECRET` / `ADMIN_PASSWORD`.
- Chats auto-delete after `RETENTION_DAYS` (default 90). `/privacy` and `/terms` pages are served; the widget links to the privacy page.
- Ops: optional Sentry (`SENTRY_DSN`), weekly DB backup workflow (`.github/workflows/backup.yml`, needs a `DATABASE_URL` repo secret), SQL migrations in `app/migrations/`.

## Tests
```bash
pip install -r requirements-dev.txt && pytest tests/test_unit.py
python -m tests.e2e    # needs an EMPTY pgvector Postgres from .env; fakes Voyage, Tavily and the LLM
# real widget + dashboard JavaScript in a simulated browser:
npm i jsdom && python -m tests.serve_fake &    # fake-backed server on :8099
NODE_PATH=$PWD/node_modules node tests/ui_test.cjs
```

## Known limits (deliberate for MVP)
- Rate limiter is in-memory (1 worker). Use Redis before scaling horizontally. On Render, per-visitor IP detection uses the `True-Client-IP` header (set in render.yaml); the per-session and per-bot limits still protect you if it is wrong.
- URL import reads one static page, not whole sites or JS-rendered pages.
- Domain allowlist stops casual key theft; it is not strong auth (Origin headers can be forged by non-browser clients). Per-bot rate limits and the monthly quota cap the damage.
- No automated billing: by design, you collect payment manually.
- `/terms` and `/privacy` are plain starting texts. Have them reviewed for your jurisdiction before charging clients.
- Never run against real Voyage/Tavily/LLM providers in CI: do one manual smoke test after deploy.
# chatbotforweb
