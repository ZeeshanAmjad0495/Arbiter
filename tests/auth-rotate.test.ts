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
  return { app, engine, auth };
}

describe('temporary-invite → forced first-login rotation', () => {
  it('admin invites (temporary), user rotates once; old key dies, new key works', async () => {
    const { app, auth } = await setup();
    const admin = await auth.issueKey('admin@acme.com', 'admin');
    const adminTok = (await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'admin@acme.com', key: admin.key } })).json().token as string;

    // Admin invites a new user → temporary key (mustRotate).
    const invite = await app.inject({ method: 'POST', url: '/v1/auth/issue-key', headers: { authorization: `Bearer ${adminTok}` }, payload: { email: 'newbie@acme.com' } });
    expect(invite.statusCode).toBe(200);
    const tempKey = invite.json().key as string;
    expect(invite.json().user.mustRotate).toBe(true);

    // Login with the temp key → session; /me flags mustRotate.
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'newbie@acme.com', key: tempKey } });
    const tok = login.json().token as string;
    expect(login.json().user.mustRotate).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${tok}` } })).json().user.mustRotate).toBe(true);

    // Rotate → new key once; mustRotate cleared; the session stays valid.
    const rot = await app.inject({ method: 'POST', url: '/v1/auth/rotate-key', headers: { authorization: `Bearer ${tok}` } });
    expect(rot.statusCode).toBe(200);
    const newKey = rot.json().key as string;
    expect(newKey).not.toBe(tempKey);
    expect((await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${tok}` } })).json().user.mustRotate).toBe(false);

    // The temporary key no longer logs in; the new one does.
    expect((await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'newbie@acme.com', key: tempKey } })).statusCode).toBe(401);
    const relogin = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'newbie@acme.com', key: newKey } });
    expect(relogin.statusCode).toBe(200);
    expect(relogin.json().user.mustRotate).toBe(false);
    await app.close();
  });

  it('rotate-key requires a session', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/v1/auth/rotate-key' })).statusCode).toBe(401);
    await app.close();
  });
});
