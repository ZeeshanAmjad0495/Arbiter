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
const noExportBlock: Grader = {
  name: 'output re-scan did not block (PII-safe output)',
  check: (o) => (o.review.decision !== 'needs_changes' ? null : `output was blocked (decision=${o.review.decision})`),
};
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
  {
    name: 'ci-failure-triage: failed tests grounded in the log + ranked hypotheses',
    workflow: 'ci-failure-triage',
    requirement: 'Triage this CI failure on the checkout suite.',
    context: [
      {
        title: 'CI run #1487 log',
        content:
          'FAILED tests/checkout/test_redeem_points_valid — AssertionError: order_total expected 90 got 100. ' +
          'FAILED tests/checkout/test_auth_cross_member — TimeoutError after 30s calling points-service. 2 failed, 128 passed.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('failedTests'), nonEmptyArray('rootCauseHypotheses'), hasString('summary')],
  },
  {
    name: 'flaky-test-advisor: patterns grounded in history + quarantine candidates',
    workflow: 'flaky-test-advisor',
    requirement: 'Triage the flaky tests in the checkout suite.',
    context: [
      {
        title: 'Test history (last 20 runs)',
        content: 'test_redeem_points_valid: pass/pass/fail/pass/fail. test_points_balance_race: fails only when run in parallel. test_checkout_smoke: stable.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('signals'), scoreInRange('flakinessScore'), hasString('summary')],
  },
  {
    name: 'incident-postmortem: timeline + typed action items + regression back-prop',
    workflow: 'incident-postmortem',
    requirement: 'Checkout redemptions failed ~22m after a deploy: points_redeemed deducted but order_total did not update; ~1,400 orders affected. Rolled back; recovered.',
    context: [],
    graders: [notNull, nonEmptyArray('timeline'), nonEmptyArray('actionItems'), nonEmptyArray('regressionTests'), hasString('rootCause')],
  },
  {
    name: 'api-test-generator: grounded suite with auth + negative coverage',
    workflow: 'api-test-generator',
    requirement: 'Generate an API test suite for the loyalty-points redemption endpoint.',
    context: [
      {
        title: 'Checkout API (v2)',
        content:
          'POST /v2/checkout/redeem — redeem loyalty points. Request fields: member_id, points_redeemed. Response fields: order_total, discount_applied, points_balance. 200 on success; 400 on insufficient points_balance; 403 on cross-member redemption.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('tests'), nonEmptyArray('fieldsReferenced'), hasString('summary')],
  },
  {
    name: 'contract-drift: breaking vs non-breaking, grounded in the contracts',
    workflow: 'contract-drift',
    requirement: 'Analyze the drift between v2 and v3 of the redemption endpoint.',
    context: [
      {
        title: 'Redemption contract v2 → v3',
        content:
          'OLD (v2) request: member_id, points_redeemed. NEW (v3) request: member_id, points_redeemed, idempotency_key (required). Response adds: transaction_id. Removed: legacy_discount_code.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('changes'), nonEmptyArray('migrationActions'), hasString('summary')],
  },
  {
    name: 'security-abuse-cases: prioritized taxonomy with test ideas',
    workflow: 'security-abuse-cases',
    requirement: 'Enumerate abuse cases for POST /v2/checkout/redeem where a member redeems loyalty points.',
    context: [{ title: 'Checkout API (v2)', content: 'POST /v2/checkout/redeem. Fields: member_id, points_redeemed, order_total, discount_applied, points_balance.' }],
    graders: [notNull, nonEmptyArray('abuseCases'), hasString('summary'), hasString('highestSeverity')],
  },
  {
    name: 'exploratory-charter: mission + tour-tagged test ideas + timebox',
    workflow: 'exploratory-charter',
    requirement: 'Explore the loyalty-points redemption flow at checkout for a 60-minute session.',
    context: [{ title: 'Checkout redemption', content: 'POST /v2/checkout/redeem. Fields: member_id, points_redeemed, order_total, discount_applied, points_balance.' }],
    graders: [notNull, nonEmptyArray('testIdeas'), nonEmptyArray('areas'), hasString('mission')],
  },
  {
    name: 'uat-script: business-readable scripts traced to grounded requirement ids',
    workflow: 'uat-script',
    requirement: 'Write UAT acceptance scripts for the loyalty-redemption requirements.',
    context: [
      {
        title: 'Redemption requirements',
        content: 'REQ-201: a member can redeem points and see the discount applied. REQ-202: a member cannot redeem more points than their balance.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('scripts'), nonEmptyArray('traceIds'), hasString('summary')],
  },
  {
    name: 'cross-req-inconsistency: cite-two-sources conflict, both ids grounded',
    workflow: 'cross-req-inconsistency',
    requirement: 'Check these redemption requirements for cross-requirement inconsistencies.',
    context: [
      {
        title: 'Redemption requirements',
        content:
          'REQ-301: redeemed points are refunded to points_balance if the order is cancelled. REQ-302: discount_applied equals points_redeemed 1:1. REQ-303: redeemed points are non-refundable once an order is placed.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('inconsistencies'), nonEmptyArray('reviewedRequirementIds'), hasString('summary')],
  },
  {
    name: 'spec-change-impact: impacted ids grounded, breaking vs behavioral',
    workflow: 'spec-change-impact',
    requirement: 'Analyze the impact of making redemption idempotent on the existing requirements and tests.',
    context: [
      {
        title: 'Spec change + affected artifacts',
        content:
          'CHANGE: redemption requires an idempotency_key and is idempotent on retry. Affected: REQ-101, REQ-102, TC-1, TC-40, endpoint POST /v2/checkout/redeem.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('impacts'), nonEmptyArray('affectedTests'), hasString('summary')],
  },
  {
    name: 'smoke-suite: minimal critical-path suite with explicit not-covered',
    workflow: 'smoke-suite',
    requirement: 'Design a smoke suite for the checkout release that includes loyalty-points redemption.',
    context: [{ title: 'Checkout release', content: 'Critical paths: add to cart, checkout, pay, redeem loyalty points.' }],
    graders: [notNull, nonEmptyArray('smokeTests'), nonEmptyArray('criticalPaths'), hasString('summary')],
  },
  {
    name: 'regression-impact: grounded re-run set vs safe-to-skip',
    workflow: 'regression-impact',
    requirement: 'A change reworked the redemption discount math. Advise the regression scope.',
    context: [
      { title: 'Existing checkout tests', content: 'TC-1 valid redemption discount; TC-2 discount reflects amount; TC-40 retry idempotency; TC-9 legacy checkout smoke.' },
    ],
    graders: [notNull, grounded, nonEmptyArray('testsToRerun'), hasString('changeSummary'), hasString('summary')],
  },
  {
    name: 'data-quality-assertions: grounded columns + integrity checks',
    workflow: 'data-quality-assertions',
    requirement: 'Draft data-quality assertions for the redemptions table.',
    context: [
      {
        title: 'redemptions table',
        content: 'Table redemptions. Columns: redemption_id, member_id, points_redeemed, order_total, discount_applied, created_at.',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('assertions'), nonEmptyArray('fieldsReferenced'), hasString('summary')],
  },
  {
    name: 'migration-test-plan: phases + mandatory reconciliation + rollback',
    workflow: 'migration-test-plan',
    requirement: 'Plan testing for migrating 4.2M member rows to the new redemptions schema.',
    context: [{ title: 'Migration context', content: 'Backfill 4.2M member rows; online cutover with a feature flag; nightly snapshot exists.' }],
    graders: [notNull, nonEmptyArray('phases'), nonEmptyArray('reconciliation'), hasString('rollbackPlan')],
  },
  {
    name: 'exec-quality-report: RAG status + key metrics + recommendations',
    workflow: 'exec-quality-report',
    requirement: 'Draft an executive quality report for the checkout release from the metrics below.',
    context: [
      {
        title: 'Quality metrics',
        content: 'Approval rate 92%. Reviewer-edit rate 18%. Grounding-violation rate 4%. 212/215 regression passed. Open: 1 minor bug; load test pending.',
      },
    ],
    graders: [notNull, nonEmptyArray('keyMetrics'), nonEmptyArray('recommendations'), hasString('headline')],
  },
  {
    name: 'synthetic-test-data: grounded columns, PII-safe output passes the re-scan gate',
    workflow: 'synthetic-test-data',
    requirement: 'Generate synthetic, PII-safe test data for the redemptions schema.',
    context: [{ title: 'redemptions schema', content: 'Columns: member_id, member_name, member_email, points_balance, points_redeemed, order_total.' }],
    // The stub emits placeholder tokens only, so the output re-scan finds no PII and the run is NOT blocked.
    graders: [notNull, grounded, nonEmptyArray('fields'), nonEmptyArray('sampleRows'), noExportBlock],
  },

  {
    name: 'accessibility-ac: WCAG criteria + assistive-tech scripts',
    workflow: 'accessibility-ac',
    requirement: 'Loyalty-points redemption at checkout: a member toggles redemption and sees the discount applied.',
    context: [],
    graders: [notNull, nonEmptyArray('criteria'), nonEmptyArray('manualScripts'), hasString('summary')],
  },
  {
    name: 'performance-test-plan: grounded endpoint + measurable scenarios',
    workflow: 'performance-test-plan',
    requirement: 'Draft a performance test plan for the loyalty-points redemption endpoint.',
    context: [{ title: 'Redemption perf context', content: 'Endpoint: POST /v2/checkout/redeem. Target SLO: p95 < 500ms, error rate < 0.1%.' }],
    graders: [notNull, grounded, nonEmptyArray('scenarios'), nonEmptyArray('slos'), hasString('summary')],
  },
  {
    name: 'nfr-result-triage: threshold breaches become bugs',
    workflow: 'nfr-result-triage',
    requirement: 'Perf run: p95 was 780ms (SLO p95 < 500ms). Missing rate limit on redemption. Contrast 3.1:1 (needs 4.5:1).',
    context: [],
    graders: [notNull, nonEmptyArray('findings'), nonEmptyArray('bugsToFile'), hasString('summary')],
  },
  {
    name: 'persona-scenarios: distinct personas + scenarios',
    workflow: 'persona-scenarios',
    requirement: 'Loyalty-points redemption at checkout.',
    context: [],
    graders: [notNull, nonEmptyArray('personas'), nonEmptyArray('scenarios'), hasString('summary')],
  },
  {
    name: 'mobile-test-cases: mobile-specific coverage + device matrix',
    workflow: 'mobile-test-cases',
    requirement: 'Redeem loyalty points in the mobile checkout flow.',
    context: [],
    graders: [notNull, nonEmptyArray('testCases'), nonEmptyArray('deviceMatrix'), hasString('summary')],
  },
  {
    name: 'mutation-survivors: grounded mutant ids + killing tests',
    workflow: 'mutation-survivors',
    requirement: 'Explain the surviving mutants from the redemption module mutation run.',
    context: [
      {
        title: 'Mutation survivors',
        content: 'M1: ConditionalBoundary at redeem.ts:42. M2: NegateConditional at redeem.ts:58 (skipped the cross-member check).',
      },
    ],
    graders: [notNull, grounded, nonEmptyArray('survivors'), hasString('summary'), hasString('coverageGap')],
  },
  {
    name: 'feature-flag-matrix: grounded flags, behavior-changing combos + stale flag',
    workflow: 'feature-flag-matrix',
    requirement: 'Build a flag test matrix for the redemption flags.',
    context: [{ title: 'Flags', content: 'redemption_batch_enabled (50%); new_discount_math (10%); legacy_promo_codes (100%, launched 8 months ago).' }],
    graders: [notNull, grounded, nonEmptyArray('combinations'), nonEmptyArray('staleFlags'), hasString('summary')],
  },
  {
    name: 'chaos-gameday: hypothesis-driven experiments with abort conditions',
    workflow: 'chaos-gameday',
    requirement: 'Plan a GameDay for the checkout redemption path and its points-service dependency.',
    context: [],
    graders: [notNull, nonEmptyArray('hypotheses'), nonEmptyArray('safetyMeasures'), hasString('rollbackPlan')],
  },
  {
    name: 'dr-drill: phased steps with RTO/RPO + per-step verification',
    workflow: 'dr-drill',
    requirement: 'Draft a DR drill for the redemptions database (RTO 1h, RPO 15m).',
    context: [],
    graders: [notNull, nonEmptyArray('steps'), hasString('rto'), hasString('rpo')],
  },
  {
    name: 'sre-runbook: diagnosis before mitigation + escalation + rollback',
    workflow: 'sre-runbook',
    requirement: 'Draft a runbook for the "redemption p95 latency high" alert.',
    context: [],
    graders: [notNull, nonEmptyArray('diagnosis'), nonEmptyArray('mitigations'), hasString('rollback')],
  },
  {
    name: 'ops-config: gated diff-plan + verification + rollback (never auto-applied)',
    workflow: 'ops-config',
    requirement: 'Draft raising the redemption rate limit from 5 to 20 requests/min per member.',
    context: [],
    graders: [notNull, hasString('diffPlan'), nonEmptyArray('verification'), hasString('rollback')],
  },
  {
    name: 'test-estimation: per-activity effort + confidence + assumptions',
    workflow: 'test-estimation',
    requirement: 'Estimate the testing effort for the loyalty-points redemption feature.',
    context: [],
    graders: [notNull, nonEmptyArray('breakdown'), nonEmptyArray('assumptions'), scoreInRange('totalHours')],
  },

  // --- Adversarial negatives: the anti-hallucination guarantee per grounded
  // workflow. Context is stripped of the ids the output cites, so every cited
  // id/endpoint/field is ungrounded → export must block + needs_changes. ---
  {
    name: 'traceability-matrix: ungrounded requirement/test ids block export',
    workflow: 'traceability-matrix',
    requirement: 'Build the traceability matrix.',
    context: [{ title: 'unrelated', content: 'This context deliberately contains no requirement or test identifiers.' }],
    graders: [groundingBlocks],
  },
  {
    name: 'compliance-mapping: ungrounded control ids block export',
    workflow: 'compliance-mapping',
    requirement: 'Map the framework controls to the feature.',
    context: [{ title: 'unrelated', content: 'A framework overview with no control identifiers listed.' }],
    graders: [groundingBlocks],
  },
  {
    name: 'api-test-generator: invented endpoint/fields block export',
    workflow: 'api-test-generator',
    requirement: 'Generate an API test suite for the endpoint.',
    context: [{ title: 'unrelated', content: 'A prose description with no endpoint paths or field names.' }],
    graders: [groundingBlocks],
  },
  {
    name: 'cross-req-inconsistency: cite-two-sources fails when the ids are absent',
    workflow: 'cross-req-inconsistency',
    requirement: 'Check these requirements for inconsistencies.',
    context: [{ title: 'unrelated', content: 'Some text with no requirement identifiers at all.' }],
    graders: [groundingBlocks],
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
