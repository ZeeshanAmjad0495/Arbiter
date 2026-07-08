import { describe, expect, it } from 'vitest';
import { KnowledgeDocument, newKnowledgeDocId, newProjectId, nowIso } from '@arbiter/core';
import { createMemoryRepositories } from '@arbiter/db';
import { buildChunks, retrieveKnowledge } from '@arbiter/guardrail';

// Hand-crafted unit vectors — no model download, so this runs in CI. Exercises the
// dense-retrieval logic (cosine ranking + the retrieveKnowledge embedder seam).
async function seed() {
  const repos = createMemoryRepositories();
  const projectId = newProjectId();
  const add = async (content: string, vec: number[]) => {
    const docId = newKnowledgeDocId();
    const chunks = buildChunks(projectId, docId, content);
    await repos.knowledge.addDocument(
      KnowledgeDocument.parse({ id: docId, projectId, title: content.slice(0, 12), sourceType: 'paste', citation: 'k://x', classification: 'internal', createdAt: nowIso() }),
      chunks,
    );
    // buildChunks yields one chunk for short text.
    await repos.knowledge.setChunkEmbedding(projectId, chunks[0]!.id, vec);
    return chunks[0]!.id;
  };
  const payments = await add('payments and refunds', [1, 0, 0]);
  const gardening = await add('gardening and tomatoes', [0, 1, 0]);
  return { repos, projectId, payments, gardening };
}

describe('dense retrieval (pgvector-shaped, model-free)', () => {
  it('ranks by cosine similarity to the query vector', async () => {
    const { repos, projectId, payments } = await seed();
    const hits = await repos.knowledge.searchByEmbedding(projectId, [0.9, 0.1, 0], 2);
    expect(hits[0]!.chunk.id).toBe(payments); // closest to the [1,0,0] axis
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
  });

  it('retrieveKnowledge routes to vector search when an embedder is supplied', async () => {
    const { repos, projectId, gardening } = await seed();
    // An embedder that maps any query to the gardening axis → gardening ranks first.
    const dense = await retrieveKnowledge(repos, projectId, 'anything', 1, { embed: async () => [0, 1, 0] });
    expect(dense[0]!.chunk.id).toBe(gardening);
    // Without an embedder it falls back to lexical TF-IDF (no vectors needed).
    const lexical = await retrieveKnowledge(repos, projectId, 'payments refunds', 1);
    expect(lexical[0]!.chunk.content).toContain('payments');
  });
});
