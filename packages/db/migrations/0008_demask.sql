-- Durable de-mask vault. Maps sanitizer placeholders back to real values so an
-- APPROVED, reviewed output can be re-identified before the user hands it off.
-- It is a PII sink by definition (§8): values are stored ENCRYPTED at rest
-- (AES-256-GCM, key held only by the app — the DB never sees plaintext) and
-- RLS-isolated per project so one tenant can never resolve another's placeholders.
-- Credentials are NEVER written here; they hard-block upstream.

CREATE TABLE IF NOT EXISTS demask_entries (
  project_id    uuid   NOT NULL REFERENCES projects (id),
  placeholder   text   NOT NULL,
  finding_type  text   NOT NULL,
  -- iv (12) || auth tag (16) || ciphertext, all AES-256-GCM. Opaque to the DB.
  cipher        bytea  NOT NULL,
  created_at_ms bigint NOT NULL,
  PRIMARY KEY (project_id, placeholder)
);
CREATE INDEX IF NOT EXISTS demask_entries_created_idx ON demask_entries (project_id, created_at_ms);

-- Per-(project,type) monotonic counter so placeholders never collide across
-- sanitize() calls. Incremented atomically in the same tx as the insert.
CREATE TABLE IF NOT EXISTS demask_counters (
  project_id   uuid   NOT NULL REFERENCES projects (id),
  finding_type text   NOT NULL,
  n            bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, finding_type)
);

ALTER TABLE demask_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE demask_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY demask_entries_project_isolation ON demask_entries
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);

ALTER TABLE demask_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE demask_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY demask_counters_project_isolation ON demask_counters
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
