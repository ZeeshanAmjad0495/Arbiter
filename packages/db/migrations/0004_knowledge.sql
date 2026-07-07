-- Wave 2 substrate: per-project knowledge store (RAG). Documents + their chunks,
-- RLS-protected exactly like artifacts/audit so retrieval can never cross tenants.

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id             uuid PRIMARY KEY,
  project_id     uuid NOT NULL REFERENCES projects (id),
  title          text NOT NULL,
  source_type    text NOT NULL DEFAULT 'paste'
                   CHECK (source_type IN ('jira', 'confluence', 'openapi', 'schema', 'repo', 'upload', 'paste', 'other')),
  citation       text NOT NULL,
  classification text NOT NULL DEFAULT 'internal'
                   CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_documents_project_idx ON knowledge_documents (project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id         uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  doc_id     uuid NOT NULL REFERENCES knowledge_documents (id) ON DELETE CASCADE,
  ordinal    integer NOT NULL,
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_chunks_project_idx ON knowledge_chunks (project_id, doc_id, ordinal);
-- Postgres FTS index — the retrieval seam swaps app-side lexical scoring for this at scale.
CREATE INDEX IF NOT EXISTS knowledge_chunks_fts_idx ON knowledge_chunks USING gin (to_tsvector('english', content));

-- RLS: same fail-closed pattern as the rest of the schema.
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_documents_project_isolation ON knowledge_documents
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);

ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY knowledge_chunks_project_isolation ON knowledge_chunks
  USING (project_id = current_setting('app.arbiter_project_id', true)::uuid)
  WITH CHECK (project_id = current_setting('app.arbiter_project_id', true)::uuid);
