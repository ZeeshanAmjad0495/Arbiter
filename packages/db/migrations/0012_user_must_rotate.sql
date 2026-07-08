-- Temporary-invite auth flow: a new user is issued a temporary access key (emailed)
-- and must generate their own permanent key on first login. `must_rotate` is true
-- until they rotate; a key reset is just the admin re-issuing a temporary key.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_rotate boolean NOT NULL DEFAULT false;
