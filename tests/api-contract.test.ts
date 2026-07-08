/**
 * API contract tests: the HTTP boundary itself — which routes are public vs
 * authenticated, the status/catalog shapes, and error handling (400/404). Distinct
 * from the flow-level e2e-zuub suite: this pins the wire contract the web app and any
 * future client depend on.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { AuthService } from '../apps/api/src/auth';
import { buildServer } from '../apps/api/src/server';

async function setup() {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'p', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'd@x.com', role: 'qa', createdAt: nowIso() }));
  const auth = new AuthService(engine.repos, 3_600_000);
  const app = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, auth, logger: false });
  await app.ready();
  const login = async (email: string, role: 'admin' | 'qa' | 'qa_lead') => {
    const { key } = await auth.issueKey(email, role);
    return (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, key } })).json().token as string;
  };
  return { app, login };
}

describe('API contract · public vs authenticated boundary', () => {
  it('serves health + status without a token, and reports auth is enabled', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const status = await app.inject({ method: 'GET', url: '/api/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().authEnabled).toBe(true);
    expect(status.json().modes.persistence).toBe('memory');
    await app.close();
  });

  it('401s every protected route without a token', async () => {
    const { app } = await setup();
    for (const url of ['/v1/knowledge', '/v1/graph', '/v1/projects', '/v1/metrics', '/v1/reviews', '/v1/executions', '/v1/writeback/target', '/v1/auth/me']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(401);
    }
    await app.close();
  });

  it('serves protected routes with a valid token', async () => {
    const { app, login } = await setup();
    const t = await login('qa@acme.com', 'qa');
    const auth = { authorization: `Bearer ${t}` };
    expect((await app.inject({ method: 'GET', url: '/v1/projects', headers: auth })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/metrics', headers: auth })).statusCode).toBe(200);
    await app.close();
  });
});

describe('API contract · catalog + error handling', () => {
  it('exposes the full 39-workflow catalog', async () => {
    const { app, login } = await setup();
    const t = await login('qa@acme.com', 'qa');
    const res = await app.inject({ method: 'GET', url: '/v1/workflows', headers: { authorization: `Bearer ${t}` } });
    expect(res.statusCode).toBe(200);
    const ids = res.json().workflows.map((w: { id: string }) => w.id);
    expect(ids.length).toBe(39);
    expect(ids).toContain('bug-report');
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    await app.close();
  });

  it('404s an unknown workflow and 400s a malformed run body', async () => {
    const { app, login } = await setup();
    const auth = { authorization: `Bearer ${await login('qa@acme.com', 'qa')}` };
    expect((await app.inject({ method: 'POST', url: '/v1/workflows/does-not-exist/run', headers: auth, payload: { requirement: 'x' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/v1/workflows/bug-report/run', headers: auth, payload: { requirement: '' } })).statusCode).toBe(400);
    await app.close();
  });

  it('404s an unknown route', async () => {
    const { app, login } = await setup();
    const res = await app.inject({ method: 'GET', url: '/v1/nope', headers: { authorization: `Bearer ${await login('qa@acme.com', 'qa')}` } });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
