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
import { type ContextInput, getWorkflow, runWorkflow } from '@arbiter/workflows';

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
    name: 'release-readiness: risk table + recommendation',
    workflow: 'release-readiness',
    requirement: '212/215 regression passed; 1 real minor bug; no blockers.',
    context: [],
    graders: [notNull, nonEmptyArray('risks'), hasString('recommendation'), hasString('summary')],
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
