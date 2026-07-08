import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { AuthService } from '../apps/api/src/auth';
import { buildServer } from '../apps/api/src/server';

async function setup() {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const defaultProjectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: defaultProjectId, name: 'Default', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'd@x.com', role: 'qa', createdAt: nowIso() }));
  // A second project that requires an explicit grant.
  const restricted = newProjectId();
  await engine.repos.projects.upsert(Project.parse({ id: restricted, name: 'Restricted', classification: 'confidential', createdAt: nowIso() }));
  const auth = new AuthService(engine.repos, 3_600_000);
  const app = buildServer({ engine, defaultProjectId, defaultActorId: actorId, auth, logger: false });
  await app.ready();
  const login = async (email: string, role: 'admin' | 'qa') => {
    const { key } = await auth.issueKey(email, role);
    return (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, key } })).json().token as string;
  };
  return { app, engine, defaultProjectId, restricted, login };
}

describe('per-user project access control', () => {
  it('a non-admin is blocked from a project until an admin grants it', async () => {
    const { app, engine, restricted, login } = await setup();
    const qaTok = await login('qa@acme.com', 'qa');
    const qaId = (await engine.repos.users.getByEmail('qa@acme.com'))!.id;

    // No grant → 403 on the restricted project.
    expect((await app.inject({ method: 'GET', url: '/v1/reviews', headers: { authorization: `Bearer ${qaTok}`, 'x-arbiter-project': restricted } })).statusCode).toBe(403);
    // It also isn't listed for them.
    const before = (await app.inject({ method: 'GET', url: '/v1/projects', headers: { authorization: `Bearer ${qaTok}` } })).json().projects;
    expect(before.map((p: { id: string }) => p.id)).not.toContain(restricted);

    // Admin grants access.
    const adminTok = await login('admin@acme.com', 'admin');
    const grant = await app.inject({ method: 'PUT', url: `/v1/admin/users/${qaId}/projects`, headers: { authorization: `Bearer ${adminTok}` }, payload: { projectIds: [restricted] } });
    expect(grant.statusCode).toBe(200);

    // Now the qa user can reach it and sees it listed.
    expect((await app.inject({ method: 'GET', url: '/v1/reviews', headers: { authorization: `Bearer ${qaTok}`, 'x-arbiter-project': restricted } })).statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/v1/projects', headers: { authorization: `Bearer ${qaTok}` } })).json().projects;
    expect(after.map((p: { id: string }) => p.id)).toContain(restricted);
    await app.close();
  });

  it('admin endpoints reject non-admins; admins see all projects', async () => {
    const { app, engine, restricted, login } = await setup();
    const qaTok = await login('qa2@acme.com', 'qa');
    const qaId = (await engine.repos.users.getByEmail('qa2@acme.com'))!.id;

    expect((await app.inject({ method: 'GET', url: '/v1/admin/users', headers: { authorization: `Bearer ${qaTok}` } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/v1/admin/users/${qaId}/role`, headers: { authorization: `Bearer ${qaTok}` }, payload: { role: 'admin' } })).statusCode).toBe(403);

    const adminTok = await login('admin2@acme.com', 'admin');
    // Admin reaches the restricted project without any grant.
    expect((await app.inject({ method: 'GET', url: '/v1/reviews', headers: { authorization: `Bearer ${adminTok}`, 'x-arbiter-project': restricted } })).statusCode).toBe(200);
    const users = (await app.inject({ method: 'GET', url: '/v1/admin/users', headers: { authorization: `Bearer ${adminTok}` } })).json().users;
    expect(users.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });
});
