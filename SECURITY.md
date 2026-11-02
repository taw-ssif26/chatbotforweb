# Security notes

## What is protected, and how
| Risk | Control |
|---|---|
| Stolen or guessed logins | bcrypt; per-account lockout (8 failures / 15 min) and per-IP limits kept in a store visitors can't touch; tokens last 3 days and die on password change, disable or delete; startup refuses weak `JWT_SECRET` / `ADMIN_PASSWORD` |
| One client reading another's data | every bot / key / source / conversation query is scoped to the signed-in user; owner endpoints require the admin role at router level |
| Stolen database | clients' API keys and your platform keys are Fernet-encrypted; passwords are bcrypt hashes |
| Server fetching internal addresses (SSRF) | URL import and the site checker: public IPs only, ports 80/443, connection pinned to the validated IP, redirects re-validated, no credentials in URLs, 30 s deadline, 2 MB cap |
| Script injection (XSS) | strict CSP on the dashboard (no inline script/style); every dynamic string escaped; widget escapes all text and only links `https://` URLs |
| Cost abuse | monthly caps per client (all messages, platform-key messages, web searches), per-IP / per-session / per-bot rate limits, ingest rate limit, query-embedding cache, input size caps (incl. chunked uploads) |
| Prompt injection | knowledge and web text are treated as data, can't close their own delimiters, and the model is told never to follow instructions inside them. This reduces the risk; no prompt can eliminate it |
| Visitors extracting your instructions, keys or knowledge base | three layers: (1) a strict safety prompt in every request (never reveal instructions or keys, never reproduce long passages or list sources, privacy of individuals, no invented facts, no medical/legal/financial advice, decline harmful requests); (2) obvious extraction attempts ("ignore previous instructions", "show your system prompt", "dump all documents", "what is your API key") are refused by code without calling the model, and logged in Conversations; (3) the reply is watched as it streams: a secret marker planted in the prompt must never appear, and copying more than `MAX_VERBATIM_CHARS` (default 600) of the knowledge base word for word is cut off |
| Error leakage | visitors see generic messages; owners see explained provider errors; server errors carry a reference code, never stack traces; Sentry (optional) never receives request bodies |
| Supply chain | versions pinned; `pip-audit`, `bandit` and `ruff` run in CI (`.github/workflows/ci.yml`) |
| Lost data | weekly backup workflow; migrations are versioned |

## Known limits (be aware, none are hidden)
- **Anything you put in a bot's knowledge can be asked about.** The model only ever sees the few most relevant passages per question, so one message cannot dump everything, but a determined visitor can ask many questions (rate limits slow this down). Never upload passwords, private customer data or documents that must stay secret.
- Prompt rules and filters reduce risk but cannot make a language model perfectly obedient. The code-level guards above exist because of that.
- **Allowed websites is not authentication.** Browsers enforce it, but a script can forge the header. Caps and rate limits bound the damage.
- Rate limits live in memory in one process; a restart resets them. Add Redis before running more than one instance.
- The lockout can be used to annoy a known email for 15 minutes. That is the price of stopping password guessing.
- Dashboard tokens are kept in `localStorage`. The CSP is what protects them; keep it strict if you edit the dashboard.
- There is no two-factor login for the owner account: use a long unique password.
- Chat text is sent to your AI, embedding and search providers. The privacy page says so; have your terms and privacy text reviewed for your country.

## Owner checklist
1. Long unique `ADMIN_PASSWORD` and `JWT_SECRET`. Never commit `.env` (it is in `.gitignore`).
2. **Back up `FERNET_KEY`.** Losing it makes every saved API key unreadable. To rotate: set `FERNET_KEY=new_key,old_key`; new data uses the first, old data still decrypts.
3. Use Neon's direct connection string (the app also works behind poolers now).
4. Add a Sentry DSN and run the backup workflow (repo secret `DATABASE_URL`).
5. Run `pip-audit -r requirements.txt` monthly (CI does it on every push).
6. If a client's key leaks: they remove it in **API keys** and revoke it at the provider. If your platform key leaks: revoke at the provider, then paste the new one in **Owner → Settings**.
7. If you suspect account takeover: reset the client's password in **Clients → Edit** (this signs out all their sessions).
