-- Richer project setup: optional metadata captured at create time, plus a
-- per-project JSON Schema store (used by the create flow and the Schema Validator).

ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_url text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS repo_path text;

CREATE TABLE IF NOT EXISTS project_schemas (
  id         uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  name       text NOT NULL,
  schema     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_schemas_project_idx ON project_schemas (project_id, created_at DESC);

ALTER TABLE project_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_schemas FORCE ROW LEVEL SECURITY;
CREATE POLICY project_schemas_project_isolation ON project_schemas
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
