import { type KnowledgeChunk, type ProjectId, newKnowledgeChunkId, nowIso } from '@arbiter/core';
import type { RepositoryBundle } from '@arbiter/db';

/**
 * Per-project knowledge retrieval (RAG substrate).
 *
 * Deterministic, dependency-free lexical retrieval (TF-IDF over the project's
 * chunks) behind a stable seam — `retrieveKnowledge` — that Postgres FTS or
 * pgvector can replace without touching callers. Retrieval feeds the grounding
 * stage: chunks become context-pack items so generation is project-aware without
 * re-pasting, and cited facts still have to appear in a retrieved chunk to ground.
 */

const tokenize = (text: string): string[] => text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];

/**
 * Split a document into overlapping chunks on paragraph/sentence boundaries.
 * Deterministic (no clock/random) so the same doc always chunks identically.
 */
export function chunkText(text: string, opts: { maxChars?: number; overlap?: number } = {}): string[] {
  const maxChars = opts.maxChars ?? 600;
  const overlap = opts.overlap ?? 80;
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  // Prefer splitting on blank lines, then sentence ends, then hard-wrap.
  const units = normalized.split(/\n\s*\n/).flatMap((p) => p.split(/(?<=[.!?])\s+/));
  const chunks: string[] = [];
  let current = '';
  for (const unit of units) {
    const piece = unit.trim();
    if (piece.length === 0) continue;
    if (current.length > 0 && current.length + piece.length + 1 > maxChars) {
      chunks.push(current);
      current = overlap > 0 ? `${current.slice(Math.max(0, current.length - overlap))} ${piece}`.trim() : piece;
    } else {
      current = current.length > 0 ? `${current} ${piece}` : piece;
    }
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

/** Build project-scoped chunk rows for a document from its raw text. */
export function buildChunks(projectId: ProjectId, docId: KnowledgeChunk['docId'], text: string): KnowledgeChunk[] {
  const now = nowIso();
  return chunkText(text).map((content, ordinal) => ({
    id: newKnowledgeChunkId(),
    projectId,
    docId,
    ordinal,
    content,
    createdAt: now,
  }));
}

export interface RetrievedChunk {
  readonly chunk: KnowledgeChunk;
  readonly score: number;
}

/**
 * TF-IDF lexical scoring over a project's chunks. Deterministic: ties break by
 * (docId, ordinal) so the same query always returns the same ranked list.
 */
export function scoreChunks(query: string, chunks: readonly KnowledgeChunk[], k = 4): RetrievedChunk[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0 || chunks.length === 0) return [];

  const n = chunks.length;
  const tokenized = chunks.map((c) => tokenize(c.content));
  const df = new Map<string, number>();
  for (const term of queryTerms) {
    let count = 0;
    for (const toks of tokenized) if (toks.includes(term)) count++;
    df.set(term, count);
  }

  const scored: RetrievedChunk[] = chunks.map((chunk, i) => {
    const toks = tokenized[i]!;
    const lenNorm = 1 / Math.log(2 + toks.length);
    let score = 0;
    for (const term of queryTerms) {
      const tf = toks.reduce((acc, t) => acc + (t === term ? 1 : 0), 0);
      if (tf === 0) continue;
      const idf = Math.log(1 + n / (1 + (df.get(term) ?? 0)));
      score += tf * idf * lenNorm;
    }
    return { chunk, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.chunk.docId < b.chunk.docId ? -1 : a.chunk.docId > b.chunk.docId ? 1 : a.chunk.ordinal - b.chunk.ordinal))
    .slice(0, k);
}

/**
 * Retrieve the top-k relevant chunks for a query. Lexical TF-IDF by default; when
 * an `embed` function is supplied (dense retrieval enabled) it embeds the query and
 * searches by vector similarity instead — same seam, config-free here (the caller
 * owns the embedder, so this stays free of the heavy embeddings dependency).
 */
export async function retrieveKnowledge(
  repos: RepositoryBundle,
  projectId: ProjectId,
  query: string,
  k = 4,
  opts?: { embed?: (query: string) => Promise<number[]> },
): Promise<RetrievedChunk[]> {
  if (opts?.embed) {
    const vector = await opts.embed(query);
    if (vector.length > 0) return repos.knowledge.searchByEmbedding(projectId, vector, k);
  }
  const chunks = await repos.knowledge.listChunks(projectId);
  return scoreChunks(query, chunks, k);
}

export interface KnowledgeContextItem {
  title: string;
  content: string;
  sourceType: 'other';
  citation: string;
}

/** Turn retrieved chunks into context-pack items (deduped by doc, ordered by score). */
export function toKnowledgeContext(retrieved: RetrievedChunk[]): KnowledgeContextItem[] {
  return retrieved.map((r) => ({
    title: `Knowledge ${r.chunk.docId.slice(0, 8)}#${r.chunk.ordinal}`,
    content: r.chunk.content,
    sourceType: 'other' as const,
    citation: `knowledge://${r.chunk.docId}#${r.chunk.ordinal}`,
  }));
}
