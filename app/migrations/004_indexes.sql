CREATE INDEX IF NOT EXISTS api_keys_user ON api_keys(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower ON users (lower(email));
