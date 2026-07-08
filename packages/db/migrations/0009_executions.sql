-- Test execution history. Arbiter authors Playwright/k6 tests; this records the
-- result of RUNNING one (via the real tool or the offline stub), normalized so
-- pass/fail feeds the project's quality metrics. RLS-isolated per project.

CREATE TABLE IF NOT EXISTS executions (
  id         uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  kind       text NOT NULL CHECK (kind IN ('playwright', 'k6')),
  name       text NOT NULL,
  mode       text NOT NULL CHECK (mode IN ('real', 'offline')),
  status     text NOT NULL CHECK (status IN ('passed', 'failed', 'error')),
  summary    jsonb NOT NULL,
  cases      jsonb NOT NULL DEFAULT '[]'::jsonb,
  exit_code  integer,
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS executions_project_created_idx ON executions (project_id, created_at DESC);

ALTER TABLE executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE executions FORCE ROW LEVEL SECURITY;
CREATE POLICY executions_project_isolation ON executions
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
