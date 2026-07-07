import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { PolicyReviewGate, SubstringGroundingValidator, createGuardrailEngine } from '@arbiter/guardrail';
import { buildContextPack } from '@arbiter/guardrail';
import { InMemoryTracer } from '@arbiter/telemetry';
import { runHello } from '@arbiter/workflows';

async function makeEngine() {
  const tracer = new InMemoryTracer();
  const engine = createGuardrailEngine({ config: loadConfig({}), tracer });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'test', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'qa@test.dev', role: 'qa', createdAt: nowIso() }));
  return { engine, tracer, projectId, actorId };
}

describe('guardrail pipeline (end-to-end, offline)', () => {
  it('runs all five stages, redacts PII, grounds output, approves, and audits', async () => {
    const { engine, tracer, projectId, actorId } = await makeEngine();
    const outcome = await runHello(engine, { projectId, actorId, autoApprove: true });

    expect(outcome.output).not.toBeNull();
    expect(outcome.sanitization.blocked).toBe(false);
    expect(outcome.sanitization.findings.length).toBeGreaterThan(0);
    expect(outcome.grounding.violations).toBe(0);
    expect(outcome.review.decision).toBe('approved');

    // Audit is persisted and covers every stage.
    const audit = await engine.repos.audit.listByRun(projectId, outcome.runId);
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(['workflow.run', 'sanitize', 'ground', 'generate', 'validate', 'gate.decision']);

    // A trace with the five pipeline stages in order.
    expect(tracer.roots.length).toBe(1);
    const stages = tracer.roots[0]?.children.map((c) => c.name);
    expect(stages).toEqual(['sanitize', 'ground', 'generate', 'validate', 'gate']);

    // Artifact was persisted and approved.
    const artifacts = await engine.repos.artifacts.listByRun(projectId, outcome.runId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]?.status).toBe('approved');
  });

  it('blocks export when the output references an ungrounded field', async () => {
    const { engine, projectId, actorId } = await makeEngine();
    const outcome = await runHello(engine, { projectId, actorId, injectUngroundedField: true });

    expect(outcome.grounding.violations).toBe(1);
    expect(outcome.grounding.blockedExport).toBe(true);
    expect(outcome.review.decision).toBe('needs_changes');
    const artifacts = await engine.repos.artifacts.listByRun(projectId, outcome.runId);
    expect(artifacts[0]?.status).toBe('in_review');
  });

  it('short-circuits before the model call when input contains a live secret', async () => {
    const { engine, projectId, actorId } = await makeEngine();
    const outcome = await runHello(engine, {
      projectId,
      actorId,
      requirement: 'Smoke test login with api key sk-ABCDEF0123456789ABCDEF for user a@b.com.',
    });

    expect(outcome.sanitization.blocked).toBe(true);
    expect(outcome.output).toBeNull();
    expect(outcome.review.decision).toBe('rejected');
    const actions = (await engine.repos.audit.listByRun(projectId, outcome.runId)).map((a) => a.action);
    expect(actions).not.toContain('generate');
    // No artifact is produced for a blocked run.
    expect(await engine.repos.artifacts.listByRun(projectId, outcome.runId)).toHaveLength(0);
  });
});

describe('grounding validator', () => {
  let validator: SubstringGroundingValidator;
  beforeEach(() => {
    validator = new SubstringGroundingValidator();
  });

  it('flags fields absent from the context pack', () => {
    const pack = buildContextPack(newProjectId(), [
      { sourceType: 'schema', title: 's', content: 'Fields: email, coverage_status', citation: 'schema://x' },
    ]);
    const report = validator.validate(
      [
        { kind: 'field', value: 'email' },
        { kind: 'field', value: 'ssn_hash' },
      ],
      pack,
    );
    expect(report.violations).toBe(1);
    expect(report.blockedExport).toBe(true);
    expect(report.claims.find((c) => c.value === 'email')?.status).toBe('grounded');
    expect(report.claims.find((c) => c.value === 'ssn_hash')?.status).toBe('ungrounded');
  });
});

describe('review gate policy', () => {
  const gate = new PolicyReviewGate();
  it('forces needs_changes on grounding violations regardless of tier', () => {
    expect(gate.decide({ riskTier: 'low', groundingBlocked: true }).decision).toBe('needs_changes');
  });
  it('requires pre-approval for high risk', () => {
    const r = gate.decide({ riskTier: 'high', groundingBlocked: false });
    expect(r.decision).toBe('pending');
    expect(r.mode).toBe('pre_approval');
  });
  it('lets low risk pass with post-hoc sampling', () => {
    const r = gate.decide({ riskTier: 'low', groundingBlocked: false });
    expect(r.decision).toBe('approved');
    expect(r.mode).toBe('post_hoc_sample');
  });
});
