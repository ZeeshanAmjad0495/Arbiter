import { type ArtifactStatus, type ProjectId, type RiskTier, nowIso } from '@arbiter/core';
import type { RepositoryBundle } from '@arbiter/db';

/**
 * Quality Metrics Aggregation Layer (Wave 2 substrate).
 *
 * Deterministic aggregation over the signals Arbiter already captures — artifact
 * status, risk tier, reviewer decisions, edit-diffs, dwell time, and grounding
 * validations — computed per project. This is the "quality trend line": it reads
 * only from the repos (no new capture), so it is honest by construction. It never
 * mutates anything.
 */
export interface QualityMetrics {
  projectId: string;
  totals: { artifacts: number; reviews: number };
  byStatus: Record<ArtifactStatus, number>;
  byRiskTier: Record<RiskTier, number>;
  byWorkflow: { type: string; count: number; approved: number; rejected: number }[];
  review: {
    /** Reviews with a terminal decision (approved/rejected). */
    decided: number;
    /** approved / decided, or null when nothing has been decided yet. */
    approvalRate: number | null;
    /** Share of decided reviews where the reviewer edited the draft (flywheel signal). */
    editRate: number | null;
    medianDwellMs: number | null;
  };
  grounding: {
    /** Number of validate-stage events. */
    validated: number;
    withViolations: number;
    /** withViolations / validated, or null when nothing has been validated. */
    violationRate: number | null;
  };
  generatedAt: string;
}

const ALL_STATUSES: ArtifactStatus[] = ['draft', 'in_review', 'approved', 'rejected', 'exported'];
const ALL_TIERS: RiskTier[] = ['low', 'medium', 'high'];

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

const ratio = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 1000;

export async function computeQualityMetrics(repos: RepositoryBundle, projectId: ProjectId): Promise<QualityMetrics> {
  const artifacts = await repos.artifacts.listByStatus(projectId, ALL_STATUSES);
  const reviews = await repos.reviews.listByProject(projectId);
  const audit = await repos.audit.listByProject(projectId);

  const byStatus = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<ArtifactStatus, number>;
  const byRiskTier = Object.fromEntries(ALL_TIERS.map((t) => [t, 0])) as Record<RiskTier, number>;
  const workflow = new Map<string, { count: number; approved: number; rejected: number }>();

  for (const a of artifacts) {
    byStatus[a.status] += 1;
    byRiskTier[a.riskTier] += 1;
    const w = workflow.get(a.type) ?? { count: 0, approved: 0, rejected: 0 };
    w.count += 1;
    if (a.status === 'approved' || a.status === 'exported') w.approved += 1;
    if (a.status === 'rejected') w.rejected += 1;
    workflow.set(a.type, w);
  }

  const decided = reviews.filter((r) => r.decision === 'approved' || r.decision === 'rejected');
  const approved = decided.filter((r) => r.decision === 'approved').length;
  const edited = decided.filter((r) => r.editDiff && r.editDiff.length > 0).length;
  const dwellValues = reviews.map((r) => r.dwellMs).filter((d): d is number => typeof d === 'number');

  const validateEvents = audit.filter((e) => e.action === 'validate');
  const withViolations = validateEvents.filter((e) => {
    const v = e.detail?.violations;
    return typeof v === 'number' && v > 0;
  }).length;

  return {
    projectId,
    totals: { artifacts: artifacts.length, reviews: reviews.length },
    byStatus,
    byRiskTier,
    byWorkflow: [...workflow.entries()]
      .map(([type, w]) => ({ type, ...w }))
      .sort((a, b) => b.count - a.count),
    review: {
      decided: decided.length,
      approvalRate: ratio(approved, decided.length),
      editRate: ratio(edited, decided.length),
      medianDwellMs: median(dwellValues),
    },
    grounding: {
      validated: validateEvents.length,
      withViolations,
      violationRate: ratio(withViolations, validateEvents.length),
    },
    generatedAt: nowIso(),
  };
}
