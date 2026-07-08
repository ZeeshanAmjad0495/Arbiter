-- Key-based auth: users carry a hashed access key; sessions have an expiry.
-- These are global auth tables (like the projects/users registry) — no RLS.

ALTER TABLE users ADD COLUMN IF NOT EXISTS access_key_hash text;

CREATE TABLE IF NOT EXISTS sessions (
  id         uuid PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users (id),
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
