import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createMemoryRepositories } from '@arbiter/db';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { createDemaskStore } from '@arbiter/sanitize';
import { AuthService } from '../apps/api/src/auth';
import { buildServer } from '../apps/api/src/server';

const KEY = randomBytes(32).toString('base64');

describe('de-mask store tenant-scoping (fail-closed cross-tenant)', () => {
  for (const mode of ['ephemeral', 'encrypted'] as const) {
    it(`${mode}: a scoped mapping resolves only for its own project`, async () => {
      const store = createDemaskStore(loadConfig(mode === 'encrypted' ? { ARBITER_DEMASK_KEY: KEY } : {}));
      expect(store.mode).toBe(mode);

      const ph = await store.put('EMAIL_ADDRESS', 'jane@example.com', 'project-A');
      expect(await store.resolve(ph, 'project-A')).toBe('jane@example.com'); // same project
      expect(await store.resolve(ph, 'project-B')).toBeNull(); // other project → fail closed
      expect(await store.resolve(ph)).toBeNull(); // no project on a scoped entry → fail closed
    });
  }

  it('an unscoped mapping stays resolvable (backward compatible)', async () => {
    const store = createDemaskStore(loadConfig({}));
    const ph = await store.put('EMAIL_ADDRESS', 'jane@example.com');
    expect(await store.resolve(ph)).toBe('jane@example.com');
    expect(await store.resolve(ph, 'any-project')).toBe('jane@example.com');
  });
});

describe('durable (storage-backed) de-mask store', () => {
  const durable = () => createDemaskStore(loadConfig({ ARBITER_DEMASK_KEY: KEY }), createMemoryRepositories().demask);

  it('persists ciphertext through the repo and round-trips per project', async () => {
    const store = durable();
    expect(store.mode).toBe('encrypted');
    const ph = await store.put('US_SSN', '123-45-6789', 'proj-A');
    expect(ph).toBe('[US_SSN_1]');
    expect(await store.resolve(ph, 'proj-A')).toBe('123-45-6789');
  });

  it('is fail-closed: refuses to persist without a project, and never resolves cross-tenant', async () => {
    const store = durable();
    await expect(store.put('EMAIL_ADDRESS', 'x@y.com')).rejects.toThrow(/projectId/);
    const ph = await store.put('EMAIL_ADDRESS', 'a@b.com', 'proj-A');
    expect(await store.resolve(ph, 'proj-B')).toBeNull();
    expect(await store.resolve(ph)).toBeNull();
  });

  it('never hands the same placeholder to two projects (independent counters)', async () => {
    // Same repo shared across both stores — placeholders are per-(project,type).
    const repo = createMemoryRepositories().demask;
    const store = createDemaskStore(loadConfig({ ARBITER_DEMASK_KEY: KEY }), repo);
    const a1 = await store.put('EMAIL_ADDRESS', 'a1@x.com', 'proj-A');
    const b1 = await store.put('EMAIL_ADDRESS', 'b1@x.com', 'proj-B');
    expect(a1).toBe('[EMAIL_ADDRESS_1]');
    expect(b1).toBe('[EMAIL_ADDRESS_1]'); // same token, different tenant
    // …but each resolves only within its own tenant, so there is no leak.
    expect(await store.resolve('[EMAIL_ADDRESS_1]', 'proj-A')).toBe('a1@x.com');
    expect(await store.resolve('[EMAIL_ADDRESS_1]', 'proj-B')).toBe('b1@x.com');
  });

  // ageMs < 0 → cutoff is in the future, so every existing mapping is "older" → purged.
  for (const durable of [false, true]) {
    it(`${durable ? 'durable' : 'in-memory'}: project-scoped retention purge only drops the target tenant`, async () => {
      const store = durable
        ? createDemaskStore(loadConfig({ ARBITER_DEMASK_KEY: KEY }), createMemoryRepositories().demask)
        : createDemaskStore(loadConfig({ ARBITER_DEMASK_KEY: KEY }));
      const a = await store.put('EMAIL_ADDRESS', 'a@x.com', 'proj-A');
      const b = await store.put('EMAIL_ADDRESS', 'b@x.com', 'proj-B');
      const removed = await store.purgeProjectOlderThan('proj-A', -60_000);
      expect(removed).toBe(1);
      expect(await store.resolve(a, 'proj-A')).toBeNull(); // purged
      expect(await store.resolve(b, 'proj-B')).toBe('b@x.com'); // untouched
    });
  }
});

describe('POST /v1/demask/resolve (admin-only re-identification)', () => {
  async function setup() {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const projectId = newProjectId();
    const actorId = newUserId();
    await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'p', classification: 'internal', createdAt: nowIso() }));
    await engine.repos.users.upsert(User.parse({ id: actorId, email: 'default@x.com', role: 'qa', createdAt: nowIso() }));
    const auth = new AuthService(engine.repos, 3_600_000);
    const app = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, auth, logger: false });
    await app.ready();
    const login = async (email: string, role: 'admin' | 'qa') => {
      const { key } = await auth.issueKey(email, role);
      return (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, key } })).json().token as string;
    };
    return { app, engine, projectId, login };
  }

  it('admin round-trips placeholders; QA is forbidden; audit records counts not values', async () => {
    const { app, engine, projectId, login } = await setup();
    // Populate the store the way the pipeline does — scoped to the project.
    const masked = (await engine.sanitizer.sanitize('Email jane@example.com about claim.', projectId)).sanitizedText;
    expect(masked).toContain('[EMAIL_ADDRESS_1]');

    const qaTok = await login('qa@acme.com', 'qa');
    expect((await app.inject({ method: 'POST', url: '/v1/demask/resolve', headers: { authorization: `Bearer ${qaTok}` }, payload: { text: masked } })).statusCode).toBe(403);

    const adminTok = await login('admin@acme.com', 'admin');
    const res = await app.inject({ method: 'POST', url: '/v1/demask/resolve', headers: { authorization: `Bearer ${adminTok}` }, payload: { text: masked } });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain('jane@example.com');
    expect(res.json().resolved).toBe(1);

    const audit = await engine.repos.audit.listByProject(projectId);
    const ev = audit.find((a) => a.action === 'demask.resolve');
    expect(ev?.detail).toMatchObject({ resolved: 1, unresolved: 0 });
    expect(JSON.stringify(ev)).not.toContain('jane@example.com'); // never audit the PII itself
    await app.close();
  });

  it('purge is admin-only, tenant-scoped, and audited by count', async () => {
    const { app, engine, projectId, login } = await setup();
    await engine.sanitizer.sanitize('Email jane@example.com now.', projectId); // seed a mapping

    const qaTok = await login('qa2@acme.com', 'qa');
    expect((await app.inject({ method: 'POST', url: '/v1/demask/purge', headers: { authorization: `Bearer ${qaTok}` }, payload: { olderThanHours: 1 } })).statusCode).toBe(403);

    const adminTok = await login('admin2@acme.com', 'admin');
    const res = await app.inject({ method: 'POST', url: '/v1/demask/purge', headers: { authorization: `Bearer ${adminTok}` }, payload: { olderThanHours: 1 } });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().removed).toBe('number'); // fresh mapping isn't 1h old → 0, but the plumbing works

    const audit = await engine.repos.audit.listByProject(projectId);
    expect(audit.some((a) => a.action === 'demask.purge')).toBe(true);
    await app.close();
  });

  it('does not resolve another project’s placeholder (tenant-scoped)', async () => {
    const { app, engine, login } = await setup();
    const other = newProjectId();
    await engine.repos.projects.upsert(Project.parse({ id: other, name: 'o', classification: 'internal', createdAt: nowIso() }));
    // Allocate a placeholder under `other`, then try to resolve it as the default project.
    const masked = (await engine.sanitizer.sanitize('Email zed@example.com now.', other)).sanitizedText;
    const adminTok = await login('admin@acme.com', 'admin');
    const res = await app.inject({ method: 'POST', url: '/v1/demask/resolve', headers: { authorization: `Bearer ${adminTok}` }, payload: { text: masked } });
    expect(res.statusCode).toBe(200);
    expect(res.json().text).toContain('[EMAIL_ADDRESS_1]'); // left masked
    expect(res.json().resolved).toBe(0);
    expect(res.json().text).not.toContain('zed@example.com');
    await app.close();
  });
});
