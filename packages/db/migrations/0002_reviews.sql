-- Phase 1: persisted human-review history (the review queue + edit-diff capture).

CREATE TABLE IF NOT EXISTS reviews (
  id          uuid PRIMARY KEY,
  project_id  uuid NOT NULL REFERENCES projects (id),
  artifact_id uuid NOT NULL REFERENCES artifacts (id),
  decision    text NOT NULL CHECK (decision IN ('pending', 'approved', 'rejected', 'needs_changes')),
  mode        text NOT NULL,
  risk_tier   text NOT NULL,
  reviewer    uuid REFERENCES users (id),
  edit_diff   text,
  dwell_ms    integer,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS reviews_project_artifact_idx ON reviews (project_id, artifact_id);

ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY reviews_project_isolation ON reviews
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
