import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { buildChunks, chunkText, createGuardrailEngine, retrieveKnowledge, scoreChunks } from '@arbiter/guardrail';
import { buildServer } from '../apps/api/src/server';

type App = ReturnType<typeof buildServer>;

describe('knowledge retrieval (RAG substrate)', () => {
  it('chunks long text into multiple ordered pieces', () => {
    const text = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} about the redemption flow and points balance.`).join(' ');
    const chunks = chunkText(text, { maxChars: 200 });
    expect(chunks.length).toBeGreaterThan(1);
  });

  it('ranks the relevant chunk above irrelevant ones', () => {
    const projectId = newProjectId();
    const docId = buildChunks(projectId, newProjectId() as never, 'x')[0]?.docId ?? (newProjectId() as never);
    const chunks = [
      { id: newProjectId() as never, projectId, docId, ordinal: 0, content: 'The checkout page uses a blue button and a footer.', createdAt: nowIso() },
      { id: newProjectId() as never, projectId, docId, ordinal: 1, content: 'Loyalty points redemption deducts points_redeemed and updates order_total.', createdAt: nowIso() },
      { id: newProjectId() as never, projectId, docId, ordinal: 2, content: 'Our office coffee machine is on the third floor.', createdAt: nowIso() },
    ];
    const ranked = scoreChunks('how does points redemption affect order_total', chunks, 2);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]!.chunk.content).toContain('points_redeemed');
  });

  it('isolates retrieval per project', async () => {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const a = newProjectId();
    const b = newProjectId();
    for (const p of [a, b]) {
      await engine.repos.projects.upsert(Project.parse({ id: p, name: 'p', classification: 'internal', createdAt: nowIso() }));
    }
    const docId = buildChunks(a, newProjectId() as never, 'x')[0]!.docId;
    await engine.repos.knowledge.addDocument(
      { id: newProjectId() as never, projectId: a, title: 'A', sourceType: 'paste', citation: 'k://a', classification: 'internal', createdAt: nowIso() },
      buildChunks(a, docId, 'Project A: redemption uses points_redeemed and order_total.'),
    );
    expect((await retrieveKnowledge(engine.repos, a, 'points_redeemed', 4)).length).toBeGreaterThan(0);
    expect(await retrieveKnowledge(engine.repos, b, 'points_redeemed', 4)).toHaveLength(0);
  });

  it('feeds grounding end-to-end: useKnowledge turns an otherwise-ungrounded run grounded', async () => {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const projectId = newProjectId();
    const actorId = newUserId();
    await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'p', classification: 'internal', createdAt: nowIso() }));
    await engine.repos.users.upsert(User.parse({ id: actorId, email: 'a@b.com', role: 'qa', createdAt: nowIso() }));
    const app: App = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, logger: false });
    await app.ready();

    const run = (useKnowledge: boolean) =>
      app.inject({
        method: 'POST',
        url: '/v1/workflows/test-case/run',
        payload: { requirement: 'Verify login returns coverage_status', context: [], autoApprove: false, useKnowledge },
      });

    // No knowledge, empty context → the stub's guessed fields are ungrounded → blocked.
    expect((await run(false)).json().grounding.blockedExport).toBe(true);

    // Store the schema as project knowledge, then run WITH retrieval → grounded.
    await app.inject({
      method: 'POST',
      url: '/v1/knowledge',
      payload: { title: 'Login schema', content: 'Login API. Valid fields: email, password, member_id, coverage_status, plan_id.' },
    });
    expect((await run(true)).json().grounding.blockedExport).toBe(false);

    await app.close();
  });
});
