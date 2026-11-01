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

## Using your own AI key (Groq, xAI Grok, OpenAI, Anthropic, OpenRouter)
1. **API keys** page: pick the provider that matches the key (`gsk_…` = Groq, `xai-…` = xAI Grok, `sk-ant-…` = Anthropic, `sk-or-…` = OpenRouter, other `sk-…` = OpenAI). The key is checked with the provider before it is saved, and a wrong provider choice is caught for you.
2. Bot **Settings**: select that key in **API key**, click **Load my models**, then pick any model in **Use any model from your own key**. Save.
3. The Install tab's checklist confirms which model answers. Messages on your own key are not limited by your plan.
The Model dropdown only lists models the owner enabled (Owner → Models); your own key is not limited to that list.

## "The assistant is having trouble right now"
Visitors only ever see that generic line. The real reason is shown to you:
1. Open the bot, **Install** tab, click **Test the AI model**. It sends one tiny message through the same path as a visitor and shows the provider's actual answer in plain English (bad key, wrong model ID, no credits, rate limit, outage).
2. The **Is everything ready?** list also shows "The last visitor chat failed" with the reason until a chat succeeds again.
3. Server side, the same error is in the logs (`llm error (bot N, provider/model): status message`).
Most common: model ID not available to that key (use **Load my models**), key under the wrong provider, free-tier rate limit or no credits.

## "I can't see the chat bubble": fix it in 2 minutes
1. Open the bot, **Install** tab. The **Is everything ready?** list shows exactly what is wrong (subscription, paused bot, no usable model or key, allowed websites).
2. Type your website address into **Check my website**. It tells you whether the snippet is in the page and whether the site is allowed.
3. Still nothing? Open your page, press F12, **Console**. The widget prints one line starting with `[AIChat]` that gives the exact reason.
4. Open `/demo?bot=YOUR_KEY` on your server: it prints the reason on screen.

Common causes: your site is not listed under **Allowed websites** (add `yourdomain.com`; `www.` and subdomains are covered); the snippet sits in a page builder that strips `<script>` tags; your site is `https` but the chatbot server is `http`; the free server was asleep (the widget retries for about a minute); you changed a setting less than 30 seconds ago (browsers cache the widget config for 30 s).

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
# widget + dashboard in a simulated browser AND real headless Chrome (installed via npm, no system Chrome needed):
(cd tests && npm install)
python -m tests.serve_fake &                   # fake-backed server on :8099, empty pgvector DB
NODE_PATH=$PWD/tests/node_modules node tests/ui_test.cjs        # jsdom, 20 checks
NODE_PATH=$PWD/tests/node_modules node tests/browser_test.cjs   # real Chrome, screenshots in /tmp/shots
```

## Known limits (deliberate for MVP)
- Rate limiter is in-memory (1 worker). Use Redis before scaling horizontally. On Render, per-visitor IP detection uses the `True-Client-IP` header (set in render.yaml); the per-session and per-bot limits still protect you if it is wrong.
- URL import reads one static page, not whole sites or JS-rendered pages.
- Domain allowlist stops casual key theft; it is not strong auth (Origin headers can be forged by non-browser clients). Per-bot rate limits and the monthly quota cap the damage.
- No automated billing: by design, you collect payment manually.
- `/terms` and `/privacy` are plain starting texts. Have them reviewed for your jurisdiction before charging clients.
- Never run against real Voyage/Tavily/LLM providers in CI: do one manual smoke test after deploy.
