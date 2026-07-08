import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { AuthService } from '../apps/api/src/auth';
import { buildServer } from '../apps/api/src/server';

async function setup(ttlMs = 3_600_000) {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'p', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'default@x.com', role: 'qa', createdAt: nowIso() }));
  const auth = new AuthService(engine.repos, ttlMs);
  const app = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, auth, logger: false });
  await app.ready();
  return { app, auth };
}

describe('key-based auth (login → session → expiry)', () => {
  it('protected routes require a session; login issues one', async () => {
    const { app, auth } = await setup();
    const { key } = await auth.issueKey('me@acme.com', 'qa');
    expect((await app.inject({ method: 'GET', url: '/v1/workflows' })).statusCode).toBe(401);
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'me@acme.com', key } });
    expect(login.statusCode).toBe(200);
    const token = login.json().token as string;
    expect((await app.inject({ method: 'GET', url: '/v1/workflows', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.json().user.email).toBe('me@acme.com');
    await app.close();
  });

  it('rejects a bad key', async () => {
    const { app, auth } = await setup();
    await auth.issueKey('me@acme.com', 'qa');
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'me@acme.com', key: 'wrong' } })).statusCode).toBe(401);
    await app.close();
  });

  it('rejects an expired session', async () => {
    const { app, auth } = await setup(-1000); // sessions are born already expired
    const { key } = await auth.issueKey('me@acme.com', 'qa');
    const token = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'me@acme.com', key } })).json().token as string;
    expect((await app.inject({ method: 'GET', url: '/v1/workflows', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401);
    await app.close();
  });

  it('only admins can issue keys, and logout invalidates the session', async () => {
    const { app, auth } = await setup();
    const admin = await auth.issueKey('admin@acme.com', 'admin');
    const qa = await auth.issueKey('qa@acme.com', 'qa');
    const adminTok = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'admin@acme.com', key: admin.key } })).json().token as string;
    const qaTok = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'qa@acme.com', key: qa.key } })).json().token as string;

    expect((await app.inject({ method: 'POST', url: '/v1/auth/issue-key', headers: { authorization: `Bearer ${adminTok}` }, payload: { email: 'new@acme.com' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/auth/issue-key', headers: { authorization: `Bearer ${qaTok}` }, payload: { email: 'x@y.com' } })).statusCode).toBe(403);

    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${qaTok}` } });
    expect((await app.inject({ method: 'GET', url: '/v1/workflows', headers: { authorization: `Bearer ${qaTok}` } })).statusCode).toBe(401);
    await app.close();
  });
});
