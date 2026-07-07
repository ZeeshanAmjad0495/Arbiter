import { AuditEvent, type ProjectId, type UserId, type WorkflowRunId, newAuditEventId, newWorkflowRunId, nowIso } from '@arbiter/core';

/**
 * WriteGate — the "every write is gated" primitive (roadmap substrate).
 *
 * The read-only default is absolute; the ONLY way Arbiter ever writes is through
 * this gate, which enforces: named human approval → apply to a registered target
 * → verify → append-only audit. It targets sandbox/integration systems
 * (GitHub / TestRail / Xray / a sandbox Jira) — and HARD-REFUSES the connected
 * production Jira workspace, the non-negotiable invariant, at both register and
 * apply time.
 */

// The connected production Jira workspace — never a legal WriteGate target.
const CONNECTED_JIRA_TARGETS = new Set(['jira', 'jira-prod', 'jira-production', 'jira-cloud', 'jira-connected']);

export interface WritePlan {
  /** Registered target id (e.g. 'sandbox', 'github', 'testrail'). Never the connected Jira. */
  targetId: string;
  /** What is being written, e.g. 'test:quarantine', 'issue', 'comment'. */
  resource: string;
  action: 'create' | 'update' | 'quarantine' | 'comment';
  /** Human-readable diff-plan shown to the approver. */
  summary: string;
  payload: unknown;
}

export interface WriteApproval {
  /** The named human accountable for this write. */
  approver: string;
  approved: boolean;
  note?: string;
}

export interface WriteResult {
  applied: boolean;
  verified: boolean;
  reference?: string;
  reason?: string;
}

/** A concrete write destination. Real targets (GitHub/TestRail) implement this later. */
export interface WriteTarget {
  readonly id: string;
  apply(plan: WritePlan): Promise<{ reference: string }>;
  verify(plan: WritePlan, reference: string): Promise<boolean>;
}

/** In-memory sandbox target — for tests/demos and as the default safe destination. */
export class SandboxWriteTarget implements WriteTarget {
  readonly id: string;
  private readonly store = new Map<string, WritePlan>();
  private seq = 0;

  constructor(id = 'sandbox') {
    this.id = id;
  }

  async apply(plan: WritePlan): Promise<{ reference: string }> {
    const reference = `${this.id}:${plan.resource}:${++this.seq}`;
    this.store.set(reference, plan);
    return { reference };
  }

  async verify(_plan: WritePlan, reference: string): Promise<boolean> {
    return this.store.has(reference);
  }

  /** Test/inspection helper — the writes this target has accepted. */
  applied(): WritePlan[] {
    return [...this.store.values()];
  }
}

export class WriteGate {
  private readonly targets = new Map<string, WriteTarget>();

  constructor(private readonly audit: { append(event: AuditEvent): Promise<AuditEvent> }) {}

  register(target: WriteTarget): void {
    if (CONNECTED_JIRA_TARGETS.has(target.id.toLowerCase())) {
      throw new Error(`writegate_forbidden_target: Arbiter never writes to the connected Jira workspace (${target.id})`);
    }
    this.targets.set(target.id, target);
  }

  async apply(input: {
    projectId: ProjectId;
    actorId: UserId;
    workflowRunId?: WorkflowRunId;
    plan: WritePlan;
    approval: WriteApproval;
  }): Promise<WriteResult> {
    const { plan, approval } = input;

    // Non-negotiable, checked again here even if register() was bypassed.
    if (CONNECTED_JIRA_TARGETS.has(plan.targetId.toLowerCase())) {
      throw new Error(`writegate_forbidden_target: ${plan.targetId} (the connected Jira workspace is read-only)`);
    }

    const target = this.targets.get(plan.targetId);
    if (!target) return { applied: false, verified: false, reason: 'unknown_target' };

    // No write without a named human on the record.
    if (!approval.approved || approval.approver.trim().length === 0) {
      return { applied: false, verified: false, reason: 'not_approved' };
    }

    const { reference } = await target.apply(plan);
    const verified = await target.verify(plan, reference);

    await this.audit.append(
      AuditEvent.parse({
        id: newAuditEventId(),
        projectId: input.projectId,
        actorId: input.actorId,
        workflowRunId: input.workflowRunId ?? newWorkflowRunId(),
        action: 'write.apply',
        sources: [reference],
        detail: { targetId: plan.targetId, resource: plan.resource, action: plan.action, approver: approval.approver, verified },
        createdAt: nowIso(),
      }),
    );

    return { applied: true, verified, reference };
  }
}
