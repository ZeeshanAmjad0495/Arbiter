import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { buildServer } from '../apps/api/src/server';

// Inferred so the test doesn't import `fastify` directly (not resolvable from the
// root tsconfig — it's a dependency of @arbiter/api, not the workspace root).
type App = ReturnType<typeof buildServer>;

async function setup() {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const defaultProjectId = newProjectId();
  const defaultActorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: defaultProjectId, name: 'Default', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: defaultActorId, email: 'a@b.com', role: 'qa', createdAt: nowIso() }));
  const app = buildServer({ engine, defaultProjectId, defaultActorId, logger: false });
  await app.ready();
  return { app, defaultProjectId };
}

function run(app: App, projectId?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/workflows/test-case/run',
    headers: projectId ? { 'x-arbiter-project': projectId } : {},
    payload: {
      requirement: 'Verify login returns coverage_status',
      context: [{ title: 's', content: 'fields: email, coverage_status, member_id, password' }],
      autoApprove: false,
    },
  });
}

describe('multi-project surface', () => {
  it('scopes the review queue and artifacts per project — no cross-project read', async () => {
    const { app, defaultProjectId } = await setup();

    // Create a second project via the API.
    const created = await app.inject({ method: 'POST', url: '/v1/projects', payload: { name: 'Project B' } });
    expect(created.statusCode).toBe(201);
    const projectB = created.json().project.id as string;
    expect(projectB).not.toBe(defaultProjectId);

    // One run into the default project (no header), one into project B (header).
    await run(app); // default
    await run(app, projectB);

    // Each project's review queue sees only its own artifact.
    const defaultQueue = (await app.inject({ method: 'GET', url: '/v1/reviews' })).json().reviews;
    const bQueue = (await app.inject({ method: 'GET', url: '/v1/reviews', headers: { 'x-arbiter-project': projectB } })).json().reviews;
    expect(defaultQueue).toHaveLength(1);
    expect(bQueue).toHaveLength(1);
    expect(defaultQueue[0].id).not.toBe(bQueue[0].id);

    // Project B cannot read the default project's artifact (isolation).
    const defaultArtifactId = defaultQueue[0].id as string;
    const crossRead = await app.inject({ method: 'GET', url: `/v1/artifacts/${defaultArtifactId}`, headers: { 'x-arbiter-project': projectB } });
    expect(crossRead.statusCode).toBe(404);

    // Same-project read works.
    const sameRead = await app.inject({ method: 'GET', url: `/v1/artifacts/${defaultArtifactId}` });
    expect(sameRead.statusCode).toBe(200);

    await app.close();
  });

  it('rejects a malformed project id (400) and an unknown project (404)', async () => {
    const { app } = await setup();
    const bad = await run(app, 'not-a-uuid');
    expect(bad.statusCode).toBe(400);
    const unknown = await run(app, newProjectId());
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });
});
