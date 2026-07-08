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
  return { app, engine, projectId, login };
}

const issue = { resource: 'issue', action: 'create', summary: 'Flaky checkout', payload: { title: 'Flaky checkout', body: 'repro…' }, approver: 'jane.qa' };

describe('gated write-back (human-approved; the only write path)', () => {
  it('target is the in-memory sandbox when GitHub is unconfigured', async () => {
    const { app, login } = await setup();
    const tok = await login('any@acme.com', 'qa');
    const t = (await app.inject({ method: 'GET', url: '/v1/writeback/target', headers: { authorization: `Bearer ${tok}` } })).json();
    expect(t.id).toBe('sandbox');
    expect(t.live).toBe(false);
    await app.close();
  });

  it('requires an admin or QA lead; a plain QA is forbidden', async () => {
    const { app, login } = await setup();
    const qa = await login('qa@acme.com', 'qa');
    expect((await app.inject({ method: 'POST', url: '/v1/writeback/apply', headers: { authorization: `Bearer ${qa}` }, payload: issue })).statusCode).toBe(403);
    await app.close();
  });

  it('a QA lead applies with a named approval → applied + verified + audited', async () => {
    const { app, engine, projectId, login } = await setup();
    const lead = await login('lead@acme.com', 'qa_lead');
    const res = await app.inject({ method: 'POST', url: '/v1/writeback/apply', headers: { authorization: `Bearer ${lead}` }, payload: issue });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ applied: true, verified: true });
    // The write is recorded in the audit log.
    const audit = await engine.repos.audit.listByProject(projectId);
    expect(audit.some((a) => a.action === 'write.apply')).toBe(true);
    await app.close();
  });

  it('refuses to apply without a named approver (validation)', async () => {
    const { app, login } = await setup();
    const admin = await login('admin@acme.com', 'admin');
    const { approver, ...noApprover } = issue;
    expect((await app.inject({ method: 'POST', url: '/v1/writeback/apply', headers: { authorization: `Bearer ${admin}` }, payload: noApprover })).statusCode).toBe(400);
    await app.close();
  });
});
