CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'client',
  plan TEXT NOT NULL DEFAULT 'starter',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id SERIAL PRIMARY KEY,
  label TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  premium_only BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (provider, model_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  label TEXT NOT NULL,
  key_enc TEXT NOT NULL,
  hint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bots (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  welcome TEXT NOT NULL DEFAULT 'Hi! How can I help you today?',
  system_prompt TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#2f5bff',
  position TEXT NOT NULL DEFAULT 'right',
  model_id INT REFERENCES models(id) ON DELETE SET NULL,
  api_key_id INT REFERENCES api_keys(id) ON DELETE SET NULL,
  allowed_domains TEXT[] NOT NULL DEFAULT '{}',
  web_search BOOLEAN NOT NULL DEFAULT FALSE,
  agency_promo BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bots_user ON bots(user_id);

CREATE TABLE IF NOT EXISTS sources (
  id SERIAL PRIMARY KEY,
  bot_id INT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  chars INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_bot ON sources(bot_id);

-- Exact (non-approximate) search filtered by bot_id: fast and accurate up to ~100k chunks per bot.
CREATE TABLE IF NOT EXISTS chunks (
  id BIGSERIAL PRIMARY KEY,
  source_id INT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  bot_id INT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  embedding vector(1024) NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_bot ON chunks(bot_id);
CREATE INDEX IF NOT EXISTS chunks_source ON chunks(source_id);

CREATE TABLE IF NOT EXISTS conversations (
  id SERIAL PRIMARY KEY,
  bot_id INT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (bot_id, session_id)
);
CREATE INDEX IF NOT EXISTS conv_bot_last ON conversations(bot_id, last_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS msg_conv ON messages(conversation_id, id);

CREATE TABLE IF NOT EXISTS usage (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  platform_msgs INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, month)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
