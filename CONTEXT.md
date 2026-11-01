## Project: Embeddable AI Chatbot SaaS (client + owner dashboards)
## Stack: FastAPI + PostgreSQL/pgvector + Voyage AI (embeddings) + Tavily (web search) + vanilla-JS dashboard + Shadow-DOM widget
## Current State: Built and verified end-to-end locally (tests/e2e.py passes against real Postgres+pgvector with fake Voyage/LLM).
  Works: owner + client logins, manual billing (Paid +30 days), plans (starter/premium), model enable/disable, platform + BYO keys (Fernet-encrypted),
  knowledge (text/URL/file -> chunks -> pgvector), RAG chat with SSE streaming, web-search fallback (premium), domain allowlist, rate limits,
  monthly quota on platform keys, conversation log, owner marketing profile injected into every bot (mention-only-when-asked).
  NOT yet verified with real keys: Voyage, Tavily, Anthropic/OpenAI/Groq streaming. Test these first on deploy.
## Active Problem: none. Widget-invisible bug fixed (same-origin GET had no Origin + Referrer-Policy:no-referrer; failures were silent). Real-Chrome tests added. Hardened + browser-simulated tests pass (e2e, unit, SSRF-pin, 20 jsdom UI checks). Next: real-key smoke test + free deploy (Render + Neon).
## Key Files:
- app/main.py - app wiring, static routes (/, /widget.js, /demo)
- app/routes/public.py - widget config + streaming chat (RAG, web fallback, model/key resolution, quota)
- app/routes/client.py - login, bots, keys, knowledge ingest, conversations
- app/routes/admin.py - clients, models, agency profile, platform keys, stats
- app/rag.py - chunking, Voyage embeddings, Tavily search, SSRF-safe URL fetch
- app/llm.py - Anthropic + OpenAI-compatible streaming over httpx
- app/plans.py - plan limits (edit to change tiers)
- app/db.py + schema.sql - schema (idempotent, runs at startup), seed data
- app/static/widget.js - the one-line embed; app/static/app.js - dashboard
- tests/e2e.py - live integration test; tests/test_unit.py - unit tests
## Decisions Made:
- One FastAPI service serves API + dashboard + widget: one deploy, no Node build. Next.js would add a second service for no gain here.
- pgvector exact search filtered by bot_id (no ANN index): accurate, simple, fine to ~100k chunks/bot.
- Voyage voyage-3.5-lite (1024d) for embeddings, owner-paid; clients only bring LLM keys.
- Tavily only when best knowledge score < 0.45 and plan allows: saves cost and latency.
- Plain httpx for LLMs instead of SDKs: one streaming code path, fewer deps.
- Cost caps: plans.py total_msgs/platform_msgs/web_searches enforced in one atomic UPSERT in routes/public.py.
- Marketing: owner profile in Settings; mode 'active' = one soft mention per chat after turn 2 (promo_shown flag), 'ask' = only when asked; Premium can turn off per bot.
- Migrations: app/migrations/*.sql applied once each at startup (advisory lock).
- Widget failures are explicit: config endpoint returns the reason (403/404 detail), widget console.warn('[AIChat] ...'), /demo prints it, Install tab has health checklist + site checker.
- Single uvicorn worker: rate limiter is in-memory. Move to Redis before scaling out.
- No Alembic yet: schema.sql is idempotent create-only. Add migrations before changing existing tables in production.
## Next Step: Deploy to Render + Neon (see README), set env vars, log in, fill Settings -> marketing profile (site + works), add platform keys, create a test client, embed on your portfolio.
