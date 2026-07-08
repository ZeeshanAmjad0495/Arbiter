-- Dense retrieval via pgvector. The 0004 knowledge substrate shipped with a stable
-- retrieveKnowledge() seam and an FTS index; this activates the vector path. Free +
-- offline: embeddings are computed in-process (all-MiniLM-L6-v2, 384-d) — no paid API.
-- TF-IDF stays the default; this column is only populated when ARBITER_EMBEDDINGS=local.
--
-- `CREATE EXTENSION vector` needs a superuser once; if the app role can't, run it as
-- the DB owner first — the IF NOT EXISTS then no-ops.
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding vector(384);

-- Cosine ANN index. ivfflat is fine at this corpus size; swap to hnsw for scale.
CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
