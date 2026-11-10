ALTER TABLE bots ADD COLUMN IF NOT EXISTS theme TEXT NOT NULL DEFAULT 'light';

CREATE TABLE IF NOT EXISTS promotions (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('offer', 'ad', 'bar')),
  title TEXT NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  badge TEXT NOT NULL DEFAULT '',
  price TEXT NOT NULL DEFAULT '',
  old_price TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  link_url TEXT NOT NULL DEFAULT '',
  cta_label TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'done', 'spam')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS leads_created ON leads(created_at DESC);
