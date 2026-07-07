-- Arbiter Phase 0 schema.
-- Multi-tenant model: shared tables + mandatory project_id filters in the app,
-- with Row-Level Security as the fail-closed backstop (§3 of the plan).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Projects & users (no RLS — these are the tenant registry itself)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id             uuid PRIMARY KEY,
  name           text NOT NULL,
  classification text NOT NULL DEFAULT 'internal'
                   CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id         uuid PRIMARY KEY,
  email      text NOT NULL UNIQUE,
  role       text NOT NULL DEFAULT 'qa' CHECK (role IN ('qa', 'qa_lead', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Artifacts (reviewable workflow output) — RLS-protected
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artifacts (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES projects (id),
  workflow_run_id uuid NOT NULL,
  type            text NOT NULL,
  status          text NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'in_review', 'approved', 'rejected', 'exported')),
  content         jsonb,
  prompt_version  text,
  model           text,
  created_by      uuid NOT NULL REFERENCES users (id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS artifacts_project_run_idx ON artifacts (project_id, workflow_run_id);

-- ---------------------------------------------------------------------------
-- Audit events (append-only governance record) — RLS-protected
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_events (
  id              uuid PRIMARY KEY,
  project_id      uuid NOT NULL REFERENCES projects (id),
  actor_id        uuid NOT NULL REFERENCES users (id),
  workflow_run_id uuid NOT NULL,
  action          text NOT NULL,
  input_sha256    text,
  prompt_version  text,
  model           text,
  sources         jsonb NOT NULL DEFAULT '[]'::jsonb,
  detail          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_project_run_idx ON audit_events (project_id, workflow_run_id);

-- ---------------------------------------------------------------------------
-- Row-Level Security. Policies read the app.arbiter_project_id GUC that the
-- app sets per transaction (SET LOCAL). current_setting(..., true) returns NULL
-- when unset, so an unscoped query matches no rows: fail closed.
-- FORCE makes even the table owner subject to the policy.
-- ---------------------------------------------------------------------------
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
CREATE POLICY artifacts_project_isolation ON artifacts
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_project_isolation ON audit_events
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
