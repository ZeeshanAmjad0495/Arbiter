import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { type KnowledgeChunk, Project, newGraphNodeId, newProjectId, nowIso } from '@arbiter/core';
import { buildChunks, buildProjectGraph, createGuardrailEngine, extractGraph, graphContext, retrieveGraphContext } from '@arbiter/guardrail';

function chunk(projectId: ReturnType<typeof newProjectId>, content: string, ordinal = 0): KnowledgeChunk {
  return { id: newGraphNodeId() as never, projectId, docId: newGraphNodeId() as never, ordinal, content, createdAt: nowIso() };
}

describe('knowledge graph (GraphRAG)', () => {
  it('extracts ids / endpoints / fields as nodes and co-occurrence edges', () => {
    const p = newProjectId();
    const chunks = [
      chunk(p, 'REQ-101 redemption on POST /v2/checkout/redeem deducts points_redeemed and updates order_total.'),
      chunk(p, 'REQ-101 also touches member_id and points_balance.', 1),
    ];
    const { nodes, edges } = extractGraph(p, chunks);
    const labels = nodes.map((n) => n.label);
    expect(labels).toContain('REQ-101');
    expect(labels).toContain('/v2/checkout/redeem');
    expect(labels).toContain('points_redeemed');
    expect(labels).toContain('order_total');
    expect(nodes.find((n) => n.label === 'REQ-101')?.type).toBe('requirement');
    expect(nodes.find((n) => n.label === 'REQ-101')?.mentions).toBe(2); // in both chunks
    expect(edges.length).toBeGreaterThan(0);
  });

  it('drops one-off noisy terms but keeps recurring ones', () => {
    const p = newProjectId();
    const { nodes } = extractGraph(p, [chunk(p, 'The Checkout page mentions member_id.'), chunk(p, 'Checkout again with order_total.', 1)]);
    // "Checkout" appears twice → kept as a term; a one-off capitalized word would be dropped.
    expect(nodes.some((n) => n.label === 'Checkout' && n.type === 'term')).toBe(true);
    const one = extractGraph(p, [chunk(p, 'A lonely Zephyr term and member_id.')]);
    expect(one.nodes.some((n) => n.label === 'Zephyr')).toBe(false);
  });

  it('graphContext seeds from the query and expands the neighborhood', () => {
    const p = newProjectId();
    const { nodes, edges } = extractGraph(p, [
      chunk(p, 'member_id relates to points_balance and order_total on /v2/checkout/redeem.'),
    ]);
    const ctx = graphContext('what affects order_total', nodes, edges);
    expect(ctx).not.toBeNull();
    expect(ctx!.content).toContain('order_total');
    // the connected neighbor is pulled in even if not in the query
    expect(ctx!.content).toContain('member_id');
  });

  it('builds + retrieves per project, isolated', async () => {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const a = newProjectId();
    const b = newProjectId();
    for (const pid of [a, b]) {
      await engine.repos.projects.upsert(Project.parse({ id: pid, name: 'p', classification: 'internal', createdAt: nowIso() }));
    }
    const docId = buildChunks(a, newGraphNodeId() as never, 'x')[0]!.docId;
    await engine.repos.knowledge.addDocument(
      { id: newGraphNodeId() as never, projectId: a, title: 'A', sourceType: 'paste', citation: 'k://a', classification: 'internal', createdAt: nowIso() },
      buildChunks(a, docId, 'Redemption: member_id, points_balance, order_total on /v2/checkout/redeem.'),
    );
    const built = await buildProjectGraph(engine.repos, a);
    expect(built.nodes).toBeGreaterThan(0);
    expect((await retrieveGraphContext(engine.repos, a, 'order_total')).length).toBe(1);
    // project B has no graph → nothing
    expect((await retrieveGraphContext(engine.repos, b, 'order_total')).length).toBe(0);
  });
});
