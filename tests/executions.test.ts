import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { buildServer } from '../apps/api/src/server';

async function setup() {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'p', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'd@x.com', role: 'qa', createdAt: nowIso() }));
  // No auth service → routes are open (unauthenticated default actor), like other endpoint tests.
  const app = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, logger: false });
  await app.ready();
  return { app, engine, projectId };
}

const PW_SCRIPT = `
  import { test, expect } from '@playwright/test';
  test('adds to cart', async () => {});
  test('failing checkout', async () => { expect(1).toBe(2); });
`;

describe('POST/GET /v1/executions (offline runner) → metrics', () => {
  it('runs offline, persists, lists, and flows into quality metrics', async () => {
    const { app } = await setup();

    const run = await app.inject({ method: 'POST', url: '/v1/executions', payload: { kind: 'playwright', script: PW_SCRIPT, name: 'cart suite' } });
    expect(run.statusCode).toBe(200);
    const exec = run.json().execution;
    expect(exec.mode).toBe('offline');
    expect(exec.status).toBe('failed'); // one failing case
    expect(exec.summary).toMatchObject({ total: 2, passed: 1, failed: 1 });

    const list = await app.inject({ method: 'GET', url: '/v1/executions' });
    expect(list.json().executions).toHaveLength(1);
    expect(list.json().executions[0].name).toBe('cart suite');

    const metrics = (await app.inject({ method: 'GET', url: '/v1/metrics' })).json().metrics;
    expect(metrics.execution.runs).toBe(1);
    expect(metrics.execution.cases).toMatchObject({ passed: 1, failed: 1 });
    expect(metrics.execution.passRate).toBe(0); // the only decided run failed
    expect(metrics.execution.byKind[0]).toMatchObject({ kind: 'playwright', runs: 1, failed: 1 });
    await app.close();
  });

  it('rejects an unknown runner kind', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/v1/executions', payload: { kind: 'cypress', script: 'x' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
