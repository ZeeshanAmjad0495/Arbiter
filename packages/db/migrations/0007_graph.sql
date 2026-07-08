-- Per-project knowledge graph (GraphRAG). Nodes + typed edges, RLS-isolated like
-- the rest of the project-scoped data. Rebuilt wholesale from knowledge on build.

CREATE TABLE IF NOT EXISTS graph_nodes (
  id         uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  label      text NOT NULL,
  type       text NOT NULL CHECK (type IN ('field', 'endpoint', 'requirement', 'test', 'control', 'term')),
  mentions   integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graph_nodes_project_idx ON graph_nodes (project_id);

CREATE TABLE IF NOT EXISTS graph_edges (
  id         uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  source_id  uuid NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
  target_id  uuid NOT NULL REFERENCES graph_nodes (id) ON DELETE CASCADE,
  relation   text NOT NULL,
  weight     real NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS graph_edges_project_idx ON graph_edges (project_id);
CREATE INDEX IF NOT EXISTS graph_edges_source_idx ON graph_edges (project_id, source_id);

ALTER TABLE graph_nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_nodes FORCE ROW LEVEL SECURITY;
CREATE POLICY graph_nodes_project_isolation ON graph_nodes
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);

ALTER TABLE graph_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE graph_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY graph_edges_project_isolation ON graph_edges
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
