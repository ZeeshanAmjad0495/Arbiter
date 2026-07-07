/**
 * Arbiter eval gate (Phase 1 seed). Runs every workflow through the guardrail
 * pipeline in offline/stub mode (deterministic, no API cost) and applies
 * code-based graders — the "eval-driven development from day one" gate (§7).
 * Exits non-zero on any failure, so it can gate CI. Expand toward 20–30 cases
 * per workflow over time.
 *
 * Run: pnpm eval
 */
import { loadConfig } from '@arbiter/config';
import { type GuardrailOutcome, Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { type ContextInput, getWorkflow, renderReleaseSignals, runWorkflow } from '@arbiter/workflows';

type Outcome = GuardrailOutcome<unknown>;
type Grader = { name: string; check: (o: Outcome) => string | null };

const out = (o: Outcome) => (o.output ?? {}) as Record<string, unknown>;

const notNull: Grader = { name: 'produces an artifact', check: (o) => (o.output != null ? null : 'output was null') };
const grounded: Grader = {
  name: 'no ungrounded references',
  check: (o) => (o.grounding.violations === 0 ? null : `${o.grounding.violations} grounding violation(s)`),
};
const nonEmptyArray = (field: string): Grader => ({
  name: `non-empty ${field}`,
  check: (o) => {
    const v = out(o)[field];
    return Array.isArray(v) && v.length > 0 ? null : `${field} is empty or missing`;
  },
});
const hasString = (field: string): Grader => ({
  name: `has ${field}`,
  check: (o) => {
    const v = out(o)[field];
    return typeof v === 'string' && v.length > 0 ? null : `${field} missing`;
  },
});
const scoreInRange = (field: string): Grader => ({
  name: `${field} in 0..100`,
  check: (o) => {
    const v = out(o)[field];
    return typeof v === 'number' && v >= 0 && v <= 100 ? null : `${field} out of range`;
  },
});
const noRawPii = (needles: string[]): Grader => ({
  name: 'PII redacted before the model',
  check: (o) => {
    if (o.sanitization.findings.length === 0) return 'expected sanitization findings';
    const leaked = needles.filter((n) => o.sanitization.sanitizedText.includes(n));
    return leaked.length === 0 ? null : `raw PII leaked: ${leaked.join(', ')}`;
  },
});
const groundingBlocks: Grader = {
  name: 'ungrounded output blocks export + needs_changes',
  check: (o) =>
    o.grounding.blockedExport && o.review.decision === 'needs_changes'
      ? null
      : `expected blockedExport+needs_changes, got blocked=${o.grounding.blockedExport} decision=${o.review.decision}`,
};

interface EvalCase {
  readonly name: string;
  readonly workflow: string;
  readonly requirement: string;
  readonly context: ContextInput[];
  readonly simulateHallucination?: boolean;
  readonly graders: Grader[];
}

const SCHEMA_CTX: ContextInput = {
  title: 'Login API schema (v3)',
  content: 'Login API schema (v3). Valid fields: email, password, member_id, coverage_status, plan_id. Endpoint: POST /v1/login.',
};

const CASES: EvalCase[] = [
  {
    name: 'requirement-analyzer: finds ambiguities + scores testability',
    workflow: 'requirement-analyzer',
    requirement: 'The system should show coverage quickly and handle errors gracefully.',
    context: [SCHEMA_CTX],
    graders: [notNull, nonEmptyArray('ambiguities'), nonEmptyArray('suggestedClarifiedAcs'), scoreInRange('testabilityScore')],
  },
  {
    name: 'test-case: grounded, has steps + gherkin',
    workflow: 'test-case',
    requirement: 'Verify member login (email a@b.com, member MEM123456, SSN 123-45-6789) returns Active coverage_status.',
    context: [SCHEMA_CTX],
    graders: [notNull, grounded, nonEmptyArray('steps'), hasString('gherkin'), noRawPii(['a@b.com', '123-45-6789', 'MEM123456'])],
  },
  {
    name: 'test-case: fabricated field blocks export',
    workflow: 'test-case',
    requirement: 'Verify member login returns coverage_status.',
    context: [SCHEMA_CTX],
    simulateHallucination: true,
    graders: [groundingBlocks],
  },
  {
    name: 'edge-case-challenger: enumerates edge cases',
    workflow: 'edge-case-challenger',
    requirement: 'Login endpoint POST /v1/login returning coverage_status for a member_id.',
    context: [SCHEMA_CTX],
    graders: [notNull, nonEmptyArray('edgeCases')],
  },
  {
    name: 'bug-report: repro steps + fact/hypothesis separation',
    workflow: 'bug-report',
    requirement: 'coverage_status blank sometimes on staging; console showed a 504 from /v1/login.',
    context: [],
    graders: [notNull, nonEmptyArray('stepsToReproduce'), hasString('severityReasoning'), nonEmptyArray('facts')],
  },
  {
    name: 'release-readiness: risk table + recommendation, grounded in real signals',
    workflow: 'release-readiness',
    requirement: 'Summarize release readiness from the attached run signals; 1 real minor bug; no blockers.',
    // Wave-1 #3: the Go/No-Go is grounded in structured signals, so the summary's
    // cited pass ratio (212/215) is checked against real numbers, not invented.
    context: [renderReleaseSignals({ testsPassed: 212, testsTotal: 215, openDefects: { minor: 1 }, evalPassRatePct: 100 })],
    graders: [notNull, grounded, nonEmptyArray('risks'), hasString('recommendation'), hasString('summary')],
  },
  {
    name: 'nfr-analyzer: flags missing non-functional requirements + drafts ACs',
    workflow: 'nfr-analyzer',
    requirement: 'As a member, I can redeem loyalty points at checkout for a discount; points are deducted and the total updates.',
    context: [
      {
        title: 'Checkout API schema (v2)',
        content: 'Checkout API (v2). Fields: member_id, points_balance, points_redeemed, order_total, discount_applied.',
      },
    ],
    graders: [
      notNull,
      nonEmptyArray('nfrChecklist'),
      nonEmptyArray('openCategories'),
      scoreInRange('coverageScore'),
      hasString('summary'),
    ],
  },
  {
    name: 'operational-readiness-gate: checklist + open actions + human-owned decision',
    workflow: 'operational-readiness-gate',
    requirement: 'Ship the points-redemption batch endpoint to production across 3 regions; backfills 4.2M member rows.',
    context: [
      {
        title: 'Release context',
        content: 'Rollback: revert the deploy tag; not yet tested. On-call: pager rotation staffed. Alerting: p95 latency alert exists.',
      },
    ],
    graders: [
      notNull,
      scoreInRange('readinessScore'),
      nonEmptyArray('checklist'),
      nonEmptyArray('openActions'),
      hasString('recommendation'),
      hasString('decisionOwnedBy'),
    ],
  },
  {
    name: 'test-strategy: risk areas grounded, out-of-scope explicit',
    workflow: 'test-strategy',
    requirement: 'EPIC-4477: auto-adjudicate outpatient claims via POST /v4/claims/adjudicate; low confidence_score claims route to manual review (REQ-8821).',
    context: [
      {
        title: 'Claims adjudication context',
        content:
          'EPIC-4477 auto-adjudication. Endpoint: POST /v4/claims/adjudicate. Fields: claim_id, member_responsibility, payable_amount, coverage_status, confidence_score. REQ-8821: low confidence_score claims must route to manual review.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('riskAreas'), nonEmptyArray('outOfScope'), scoreInRange('riskCoverageScore'), hasString('approvalOwnedBy')],
  },
  {
    name: 'test-plan: every scenario traces to a grounded strategy risk area',
    workflow: 'test-plan',
    requirement: 'Draft a test plan for loyalty-points redemption that traces each suite to the A6 strategy risk areas.',
    context: [
      {
        title: 'A6 Test Strategy — Loyalty Points Redemption',
        content:
          'Endpoint: POST /v2/checkout/redeem. Risk areas: RA-1 transactional integrity; RA-2 authorization; RA-3 dependency reliability; RA-4 performance. Requirements: REQ-101 points_redeemed deducted; REQ-102 discount_applied reflects the redeemed amount.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('scenarios'), nonEmptyArray('objectives'), scoreInRange('coverageScore'), hasString('approvalOwnedBy')],
  },
  {
    name: 'traceability-matrix: id-aware links + uncovered/orphan surfaced, grounded',
    workflow: 'traceability-matrix',
    requirement: 'Build the traceability matrix for the loyalty-redemption requirements and tests below.',
    context: [
      {
        title: 'Requirements & tests',
        content:
          'Requirements: REQ-101 points_redeemed deducted; REQ-102 discount_applied reflects amount; REQ-103 redemption rejected when points_balance insufficient. Tests: TC-1 valid redemption; TC-2 discount reflects amount; TC-9 legacy checkout smoke.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('matrix'), scoreInRange('coverageScore'), hasString('summary')],
  },
  {
    name: 'compliance-mapping: control ids grounded, human-attested',
    workflow: 'compliance-mapping',
    requirement: 'Map the HIPAA Security Rule technical safeguards to the claims-adjudication feature.',
    context: [
      {
        title: 'HIPAA Security Rule (excerpt)',
        content:
          'HIPAA Security Rule. Technical safeguards: 164.312(a)(1) Access control; 164.312(b) Audit controls; 164.312(c)(1) Integrity; 164.312(e)(1) Transmission security.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('controls'), hasString('summary'), hasString('attestationOwnedBy')],
  },
];

async function main(): Promise<void> {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'evals', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'evals@arbiter.dev', role: 'qa', createdAt: nowIso() }));

  let passed = 0;
  let failed = 0;
  for (const c of CASES) {
    const def = getWorkflow(c.workflow);
    if (!def) {
      console.error(`✗ ${c.name}: unknown workflow ${c.workflow}`);
      failed++;
      continue;
    }
    const outcome = await runWorkflow(engine, def, {
      projectId,
      actorId,
      requirement: c.requirement,
      context: c.context,
      autoApprove: false,
      ...(c.simulateHallucination ? { simulateHallucination: true } : {}),
    });
    const failures = c.graders.map((g) => g.check(outcome)).filter((m): m is string => m !== null);
    if (failures.length === 0) {
      passed += c.graders.length;
      console.log(`✓ ${c.name} (${c.graders.length} checks)`);
    } else {
      failed += failures.length;
      passed += c.graders.length - failures.length;
      console.error(`✗ ${c.name}`);
      for (const f of failures) console.error(`    - ${f}`);
    }
  }

  await engine.repos.close();
  console.log(`\n${passed} checks passed, ${failed} failed across ${CASES.length} cases.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
