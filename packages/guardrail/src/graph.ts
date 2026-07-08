import {
  type GraphEdge,
  type GraphNode,
  type GraphNodeType,
  type KnowledgeChunk,
  type ProjectId,
  newGraphEdgeId,
  newGraphNodeId,
  nowIso,
} from '@arbiter/core';
import type { RepositoryBundle } from '@arbiter/db';
import type { KnowledgeContextItem } from './knowledge';

/**
 * Per-project knowledge graph (GraphRAG).
 *
 * Fully deterministic, dependency-free extraction from the project's knowledge
 * chunks (no LLM required — an LLM triple-extraction upgrade can slot in behind
 * `extractGraph` later). Entities are ids / endpoints / fields / controls / terms;
 * edges are intra-chunk co-occurrence. Graph-aware retrieval seeds nodes from a
 * query and expands one hop, assembling a connected "graph facts" context item
 * that feeds the SAME grounding stage as flat RAG — so cited entities still have
 * to appear in the context to ground.
 */

// --- Extraction patterns (highest-priority type wins per token) ---
const RE = {
  id: /\b[A-Z][A-Z0-9]{1,}-\d+\b/g, // REQ-101, TC-9, EPIC-4477, RA-1
  endpoint: /\/v\d+\/[A-Za-z0-9/_-]+/g, // /v2/checkout/redeem
  control: /\b\d{3}\.\d{3}\([a-z]\)(?:\(\d\))?/g, // 164.312(a)(1)
  field: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, // member_id, order_total
  term: /\b[A-Z][a-z]{3,}(?:[ ][A-Z][a-z]{3,})?\b/g, // Checkout, Points Service
};

// Bounds — keep the graph small + the edge set from exploding on noisy text.
const MAX_ENTITIES_PER_CHUNK_FOR_EDGES = 10;
const MAX_NODES = 600;
const MAX_EDGES = 2500;
const TERM_MIN_MENTIONS = 2; // noisy 'term' entities must recur to become nodes

interface Candidate {
  label: string;
  type: GraphNodeType;
}

const priorityRank = (t: GraphNodeType): number =>
  ['requirement', 'test', 'endpoint', 'control', 'field', 'term'].indexOf(t);

/** Keep the highest-priority type when a label matches more than one pattern. */
function classify(label: string, type: GraphNodeType, byLabel: Map<string, GraphNodeType>): void {
  const existing = byLabel.get(label);
  if (!existing || priorityRank(type) < priorityRank(existing)) byLabel.set(label, type);
}

/** Extract the candidate entities from one chunk (deduped by label, highest-priority type). */
function entitiesOf(text: string): Candidate[] {
  const byLabel = new Map<string, GraphNodeType>();
  for (const m of text.matchAll(RE.id)) {
    const label = m[0];
    classify(label, label.toUpperCase().startsWith('TC-') ? 'test' : 'requirement', byLabel);
  }
  for (const m of text.matchAll(RE.endpoint)) classify(m[0], 'endpoint', byLabel);
  for (const m of text.matchAll(RE.control)) classify(m[0], 'control', byLabel);
  for (const m of text.matchAll(RE.field)) classify(m[0], 'field', byLabel);
  for (const m of text.matchAll(RE.term)) classify(m[0], 'term', byLabel);
  return [...byLabel].map(([label, type]) => ({ label, type }));
}

/** Build a project graph {nodes, edges} from knowledge chunks. Deterministic. */
export function extractGraph(projectId: ProjectId, chunks: readonly KnowledgeChunk[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const now = nowIso();
  // Pass 1: collect candidates per chunk + global mention counts.
  const perChunk: Candidate[][] = chunks.map((c) => entitiesOf(c.content));
  const mentions = new Map<string, number>(); // key = `${type}:${label}`
  for (const cands of perChunk) {
    for (const c of cands) {
      const k = `${c.type}:${c.label}`;
      mentions.set(k, (mentions.get(k) ?? 0) + 1);
    }
  }

  // Promote to nodes: ids/endpoints/controls/fields always; terms must recur.
  const nodeByKey = new Map<string, GraphNode>();
  const keep = (c: Candidate): boolean => c.type !== 'term' || (mentions.get(`${c.type}:${c.label}`) ?? 0) >= TERM_MIN_MENTIONS;
  for (const [k, count] of mentions) {
    const sep = k.indexOf(':');
    const type = k.slice(0, sep) as GraphNodeType;
    const label = k.slice(sep + 1);
    if (!keep({ label, type })) continue;
    if (nodeByKey.size >= MAX_NODES) break;
    nodeByKey.set(k, { id: newGraphNodeId(), projectId, label, type, mentions: count, createdAt: now });
  }

  // Pass 2: co-occurrence edges within each chunk, among kept nodes only.
  const edgeWeight = new Map<string, { a: GraphNode; b: GraphNode; w: number }>();
  for (const cands of perChunk) {
    const nodes = cands
      .map((c) => nodeByKey.get(`${c.type}:${c.label}`))
      .filter((n): n is GraphNode => Boolean(n))
      .sort((x, y) => priorityRank(x.type) - priorityRank(y.type) || y.mentions - x.mentions)
      .slice(0, MAX_ENTITIES_PER_CHUNK_FOR_EDGES);
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const [a, b] = nodes[i]!.id < nodes[j]!.id ? [nodes[i]!, nodes[j]!] : [nodes[j]!, nodes[i]!];
        const key = `${a.id}|${b.id}`;
        const cur = edgeWeight.get(key);
        if (cur) cur.w += 1;
        else if (edgeWeight.size < MAX_EDGES) edgeWeight.set(key, { a, b, w: 1 });
      }
    }
  }

  const edges: GraphEdge[] = [...edgeWeight.values()].map(({ a, b, w }) => ({
    id: newGraphEdgeId(),
    projectId,
    sourceId: a.id,
    targetId: b.id,
    relation: 'co_occurs',
    weight: w,
    createdAt: now,
  }));
  return { nodes: [...nodeByKey.values()], edges };
}

/** Rebuild the project's graph from its current knowledge, and persist it. */
export async function buildProjectGraph(repos: RepositoryBundle, projectId: ProjectId): Promise<{ nodes: number; edges: number }> {
  const chunks = await repos.knowledge.listChunks(projectId);
  const { nodes, edges } = extractGraph(projectId, chunks);
  await repos.graph.replaceGraph(projectId, nodes, edges);
  return { nodes: nodes.length, edges: edges.length };
}

const tokenize = (s: string): string[] => s.toLowerCase().match(/[a-z0-9_./-]{2,}/g) ?? [];

/**
 * GraphRAG retrieval: seed nodes from the query, expand one hop, and assemble a
 * connected "graph facts" context item (labels + their strongest relations).
 */
export function graphContext(
  query: string,
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  opts: { seeds?: number; maxNodes?: number } = {},
): KnowledgeContextItem | null {
  if (nodes.length === 0) return null;
  const maxNodes = opts.maxNodes ?? 14;
  const seedCap = opts.seeds ?? 6;
  const qTokens = new Set(tokenize(query));
  const qLower = query.toLowerCase();

  // Seed: nodes whose label is mentioned in the query (substring) or shares a token.
  const scoreSeed = (n: GraphNode): number => {
    const label = n.label.toLowerCase();
    let s = 0;
    if (qLower.includes(label)) s += 3;
    for (const t of tokenize(n.label)) if (qTokens.has(t)) s += 1;
    return s + Math.min(n.mentions, 5) * 0.1;
  };
  const seeds = nodes
    .map((n) => ({ n, s: scoreSeed(n) }))
    .filter((x) => x.s >= 1)
    .sort((a, b) => b.s - a.s || b.n.mentions - a.n.mentions)
    .slice(0, seedCap)
    .map((x) => x.n);
  if (seeds.length === 0) return null;

  // Expand one hop, ranking neighbors by edge weight.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const selected = new Map<string, GraphNode>();
  for (const s of seeds) selected.set(s.id, s);
  const neighborScore = new Map<string, number>();
  for (const e of edges) {
    const hitSource = selected.has(e.sourceId);
    const hitTarget = selected.has(e.targetId);
    if (hitSource === hitTarget) continue; // both or neither seeded
    const other = hitSource ? e.targetId : e.sourceId;
    neighborScore.set(other, (neighborScore.get(other) ?? 0) + e.weight);
  }
  for (const [id, w] of [...neighborScore].sort((a, b) => b[1] - a[1])) {
    if (selected.size >= maxNodes) break;
    const n = byId.get(id as GraphNode['id']);
    if (n) selected.set(id, n);
  }

  // Render: each selected node with its strongest related labels.
  const related = new Map<string, { label: string; w: number }[]>();
  for (const e of edges) {
    if (!selected.has(e.sourceId) || !selected.has(e.targetId)) continue;
    const a = byId.get(e.sourceId)!;
    const b = byId.get(e.targetId)!;
    (related.get(a.id) ?? related.set(a.id, []).get(a.id)!).push({ label: b.label, w: e.weight });
    (related.get(b.id) ?? related.set(b.id, []).get(b.id)!).push({ label: a.label, w: e.weight });
  }
  const lines = [...selected.values()].map((n) => {
    const rel = (related.get(n.id) ?? []).sort((x, y) => y.w - x.w).slice(0, 6).map((r) => r.label);
    return rel.length ? `${n.label} [${n.type}] → ${rel.join(', ')}` : `${n.label} [${n.type}]`;
  });

  return {
    title: 'Project graph context',
    content: `Related entities in this project (from the knowledge graph):\n${lines.join('\n')}`,
    sourceType: 'other',
    citation: 'graph://retrieval',
  };
}

/** Retrieve graph-aware context for a query from the project's stored graph. */
export async function retrieveGraphContext(
  repos: RepositoryBundle,
  projectId: ProjectId,
  query: string,
  opts?: { seeds?: number; maxNodes?: number },
): Promise<KnowledgeContextItem[]> {
  const [nodes, edges] = await Promise.all([repos.graph.listNodes(projectId), repos.graph.listEdges(projectId)]);
  const ctx = graphContext(query, nodes, edges, opts);
  return ctx ? [ctx] : [];
}
