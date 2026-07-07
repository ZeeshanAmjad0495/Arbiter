import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import {
  AuditEvent,
  Project,
  ReviewLog,
  User,
  newAuditEventId,
  newProjectId,
  newReviewLogId,
  newUserId,
  nowIso,
} from '@arbiter/core';
import { computeQualityMetrics, createGuardrailEngine } from '@arbiter/guardrail';
import { getWorkflow, runWorkflow } from '@arbiter/workflows';

const CTX = [{ title: 's', content: 'fields: email, coverage_status, member_id, password' }];

describe('quality metrics aggregation', () => {
  it('aggregates status, approval/edit rates, dwell, and grounding-violation rate per project', async () => {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const projectId = newProjectId();
    const actorId = newUserId();
    await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'm', classification: 'internal', createdAt: nowIso() }));
    await engine.repos.users.upsert(User.parse({ id: actorId, email: 'a@b.com', role: 'qa', createdAt: nowIso() }));

    const base = { projectId, actorId, requirement: 'Verify login returns coverage_status', context: CTX };

    // A) auto-approved run → approved, no human review log.
    await runWorkflow(engine, getWorkflow('test-case')!, { ...base, autoApprove: true });

    // B) run needing review → in_review, then a human approves WITH an edit + dwell.
    await runWorkflow(engine, getWorkflow('test-case')!, { ...base, autoApprove: false });
    const pending = await engine.repos.artifacts.listByStatus(projectId, ['in_review']);
    const artifact = pending[0]!;
    const now = nowIso();
    await engine.repos.applyReviewDecision({
      projectId,
      artifactId: artifact.id,
      status: 'approved',
      review: ReviewLog.parse({
        id: newReviewLogId(),
        projectId,
        artifactId: artifact.id,
        decision: 'approved',
        mode: 'pre_approval',
        riskTier: artifact.riskTier,
        reviewer: actorId,
        editDiff: '- old\n+ new',
        dwellMs: 4200,
        decidedAt: now,
        createdAt: now,
      }),
      audit: AuditEvent.parse({
        id: newAuditEventId(),
        projectId,
        actorId,
        workflowRunId: artifact.workflowRunId,
        action: 'gate.decision',
        sources: [],
        detail: { decision: 'approved' },
        createdAt: now,
      }),
    });

    // C) hallucinated run → grounding violation, blocked, stays in review.
    await runWorkflow(engine, getWorkflow('test-case')!, { ...base, autoApprove: false, simulateHallucination: true });

    const m = await computeQualityMetrics(engine.repos, projectId);

    expect(m.totals.artifacts).toBe(3);
    expect(m.byStatus.approved).toBe(2); // A + B
    expect(m.byStatus.in_review).toBe(1); // C
    expect(m.review.decided).toBe(1); // only the human decision on B
    expect(m.review.approvalRate).toBe(1);
    expect(m.review.editRate).toBe(1);
    expect(m.review.medianDwellMs).toBe(4200);
    expect(m.grounding.validated).toBe(3);
    expect(m.grounding.withViolations).toBe(1); // C
    expect(m.grounding.violationRate).toBeCloseTo(0.333, 2);

    // Isolation: a different project sees nothing.
    const other = newProjectId();
    const empty = await computeQualityMetrics(engine.repos, other);
    expect(empty.totals.artifacts).toBe(0);
    expect(empty.review.approvalRate).toBeNull();
  });
});
