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
  unifiedDiff,
} from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { getWorkflow, runWorkflow } from '@arbiter/workflows';

describe('review queue', () => {
  it('non-auto-approved run enters the queue; approve-with-edit captures a diff and flips status', async () => {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const projectId = newProjectId();
    const actorId = newUserId();
    await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 't', classification: 'internal', createdAt: nowIso() }));
    await engine.repos.users.upsert(User.parse({ id: actorId, email: 'a@b.com', role: 'qa', createdAt: nowIso() }));

    const def = getWorkflow('test-case');
    expect(def).toBeTruthy();
    const outcome = await runWorkflow(engine, def!, {
      projectId,
      actorId,
      requirement: 'Verify login returns coverage_status',
      context: [{ title: 's', content: 'fields: email, coverage_status, member_id, password' }],
      autoApprove: false,
    });
    expect(outcome.review.decision).toBe('pending');

    // It lands in the review queue.
    const pending = await engine.repos.artifacts.listByStatus(projectId, ['in_review']);
    expect(pending).toHaveLength(1);
    const artifact = pending[0]!;
    expect(artifact.riskTier).toBe('medium');

    // Reviewer edits the title; the diff is captured.
    const before = JSON.stringify(artifact.content, null, 2);
    const editedContent = { ...(artifact.content as Record<string, unknown>), title: 'Reviewer-edited title' };
    const diff = unifiedDiff(before, JSON.stringify(editedContent, null, 2));
    expect(diff).toContain('+ ');
    expect(diff).toContain('Reviewer-edited title');

    // Approve with the edit → status flips, content updated, queue drains.
    const updated = await engine.repos.artifacts.update(projectId, artifact.id, { status: 'approved', content: editedContent });
    expect(updated?.status).toBe('approved');
    expect((updated?.content as { title: string }).title).toBe('Reviewer-edited title');
    expect(await engine.repos.artifacts.listByStatus(projectId, ['in_review'])).toHaveLength(0);
  });

  it('applyReviewDecision writes status + review + audit atomically', async () => {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const projectId = newProjectId();
    const actorId = newUserId();
    await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 't', classification: 'internal', createdAt: nowIso() }));
    await engine.repos.users.upsert(User.parse({ id: actorId, email: 'a@b.com', role: 'qa', createdAt: nowIso() }));
    const outcome = await runWorkflow(engine, getWorkflow('test-case')!, {
      projectId,
      actorId,
      requirement: 'Verify login returns coverage_status',
      context: [{ title: 's', content: 'fields: email, coverage_status, member_id, password' }],
      autoApprove: false,
    });
    const artifact = (await engine.repos.artifacts.listByStatus(projectId, ['in_review']))[0]!;
    const now = nowIso();
    const review = ReviewLog.parse({
      id: newReviewLogId(),
      projectId,
      artifactId: artifact.id,
      decision: 'approved',
      mode: 'pre_approval',
      riskTier: artifact.riskTier,
      reviewer: actorId,
      decidedAt: now,
      createdAt: now,
    });
    const audit = AuditEvent.parse({
      id: newAuditEventId(),
      projectId,
      actorId,
      workflowRunId: artifact.workflowRunId,
      action: 'gate.decision',
      sources: [],
      detail: { decision: 'approved', source: 'human_review' },
      createdAt: now,
    });
    const updated = await engine.repos.applyReviewDecision({ projectId, artifactId: artifact.id, status: 'approved', review, audit });
    expect(updated?.status).toBe('approved');
    expect(await engine.repos.reviews.listByArtifact(projectId, artifact.id)).toHaveLength(1);
    expect((await engine.repos.audit.listByRun(projectId, artifact.workflowRunId)).some((a) => a.action === 'gate.decision')).toBe(true);
  });
});
