import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { SandboxWriteTarget, WriteGate, createGuardrailEngine } from '@arbiter/guardrail';
import type { WritePlan } from '@arbiter/guardrail';

async function setup() {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 't', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'a@b.com', role: 'qa_lead', createdAt: nowIso() }));
  const gate = new WriteGate(engine.repos.audit);
  const sandbox = new SandboxWriteTarget('sandbox');
  gate.register(sandbox);
  return { engine, projectId, actorId, gate, sandbox };
}

const PLAN: WritePlan = {
  targetId: 'sandbox',
  resource: 'test:quarantine',
  action: 'quarantine',
  summary: 'Quarantine flaky test_redeem_points_valid',
  payload: { test: 'test_redeem_points_valid' },
};

describe('WriteGate (every write is gated)', () => {
  it('refuses to apply without a named human approval', async () => {
    const { projectId, actorId, gate, sandbox } = await setup();
    const r = await gate.apply({ projectId, actorId, plan: PLAN, approval: { approver: '', approved: false } });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('not_approved');
    expect(sandbox.applied()).toHaveLength(0);
  });

  it('applies, verifies, and audits an approved write to the sandbox', async () => {
    const { engine, projectId, actorId, gate, sandbox } = await setup();
    const r = await gate.apply({ projectId, actorId, plan: PLAN, approval: { approver: 'qa-lead', approved: true } });
    expect(r.applied).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.reference).toContain('sandbox:test:quarantine:');
    expect(sandbox.applied()).toHaveLength(1);
    const audit = await engine.repos.audit.listByProject(projectId);
    const write = audit.find((a) => a.action === 'write.apply');
    expect(write).toBeTruthy();
    expect(write!.detail.approver).toBe('qa-lead');
    expect(write!.detail.verified).toBe(true);
  });

  it('HARD-refuses the connected Jira workspace as a target (non-negotiable)', async () => {
    const { projectId, actorId, gate } = await setup();
    // Cannot even register it.
    expect(() => gate.register(new SandboxWriteTarget('jira'))).toThrow('writegate_forbidden_target');
    // And apply throws even if a plan names it directly.
    await expect(
      gate.apply({ projectId, actorId, plan: { ...PLAN, targetId: 'jira' }, approval: { approver: 'x', approved: true } }),
    ).rejects.toThrow('writegate_forbidden_target');
  });

  it('returns unknown_target for an unregistered destination', async () => {
    const { projectId, actorId, gate } = await setup();
    const r = await gate.apply({ projectId, actorId, plan: { ...PLAN, targetId: 'testrail' }, approval: { approver: 'x', approved: true } });
    expect(r.applied).toBe(false);
    expect(r.reason).toBe('unknown_target');
  });
});
