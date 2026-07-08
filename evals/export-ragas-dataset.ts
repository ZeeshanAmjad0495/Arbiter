/**
 * Ragas dataset exporter. Runs grounded workflows through the guardrail pipeline
 * and writes a Ragas-shaped JSONL — `{ question, answer, contexts, ground_truth }`
 * — that `evals/ragas_eval.py` scores for faithfulness / answer-relevancy /
 * context-precision. Runs offline (deterministic stub) so the dataset is
 * reproducible and needs no API key; point it at real models by setting the
 * usual provider env before running.
 *
 * Run: pnpm eval:export-ragas   → writes evals/ragas-dataset.jsonl
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '@arbiter/config';
import { type GuardrailOutcome, Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { type ContextInput, getWorkflow, runWorkflow } from '@arbiter/workflows';

interface RagasRow {
  question: string;
  answer: string;
  contexts: string[];
  ground_truth: string;
}

const SCHEMA_CTX: ContextInput = {
  title: 'Login API schema (v3)',
  content: 'Login API schema (v3). Valid fields: email, password, member_id, coverage_status, plan_id. Endpoint: POST /v1/login. Requirement REQ-101 governs eligibility display.',
};

// Grounded cases (context contains the ids/fields the answer must cite) so a
// faithful pipeline scores high and any drift is visible.
const CASES: { workflow: string; requirement: string; context: ContextInput[]; ground_truth: string }[] = [
  {
    workflow: 'test-case',
    requirement: 'Verify member login returns Active coverage_status for a valid member_id.',
    context: [SCHEMA_CTX],
    ground_truth: 'A grounded test case referencing coverage_status and member_id against POST /v1/login.',
  },
  {
    workflow: 'requirement-analyzer',
    requirement: 'The system should show coverage quickly and handle errors gracefully.',
    context: [SCHEMA_CTX],
    ground_truth: 'Ambiguities around "quickly" and "gracefully" plus testability scoring, grounded in the login schema.',
  },
  {
    workflow: 'edge-case-challenger',
    requirement: 'Enumerate edge cases for the login coverage_status field.',
    context: [SCHEMA_CTX],
    ground_truth: 'Edge cases across boundary/negative/schema-drift for coverage_status and member_id.',
  },
];

async function main(): Promise<void> {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'ragas', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'ragas@arbiter.dev', role: 'qa', createdAt: nowIso() }));

  const rows: RagasRow[] = [];
  for (const c of CASES) {
    const def = getWorkflow(c.workflow);
    if (!def) continue;
    const outcome: GuardrailOutcome<unknown> = await runWorkflow(engine, def, { projectId, actorId, requirement: c.requirement, context: c.context, autoApprove: false });
    rows.push({
      question: c.requirement,
      answer: JSON.stringify(outcome.output ?? {}),
      contexts: outcome.contextPack.items.map((i) => i.content),
      ground_truth: c.ground_truth,
    });
  }
  await engine.repos.close();

  const outPath = join(process.cwd(), 'evals', 'ragas-dataset.jsonl');
  writeFileSync(outPath, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf8');
  console.log(`Wrote ${rows.length} rows → ${outPath}`);
  console.log('Score with: python evals/ragas_eval.py   (pip install ragas datasets)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
