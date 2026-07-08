/**
 * Deterministic, offline, no-auth API boot for browser E2E, a11y and LLM-output tests.
 *
 * Uses the in-memory store + the stub LLM (loadConfig with an empty env), so it needs
 * no Postgres, no keys and no network — the same offline-first contract as CI. Auth is
 * left disabled (no AuthService passed to buildServer), so `/api/status` reports
 * `authEnabled:false` and the web app renders without a login. A small corpus is seeded
 * so the knowledge, concept-map and metrics pages have something real to show.
 *
 * Run: pnpm e2e:api   (ARBITER_API_PORT defaults to 4311 to avoid the dev API on 4310)
 */
import { loadConfig } from '@arbiter/config';
import { Project, ProjectId, User, UserId, newKnowledgeDocId, nowIso } from '@arbiter/core';
import { buildChunks, buildProjectGraph, createGuardrailEngine } from '@arbiter/guardrail';
import { buildServer } from './server';

const PROJECT = ProjectId.parse('00000000-0000-4000-8000-000000000001');
const ACTOR = UserId.parse('00000000-0000-4000-8000-000000000002');

const SEED_DOCS: { title: string; text: string }[] = [
  {
    title: 'IV-4101 — Delta Dental eligibility deductible',
    text: 'Insurance verification for Delta Dental. Fields: individual_deductible, family_deductible, coverage_status, plan_name. Endpoint: /v1/insurance-verifications. Payer: Delta Dental.',
  },
  {
    title: 'CL-2277 — Cigna claim retrieval timeout',
    text: 'Claim retrieval for Cigna times out. Fields: claim_status, paid_amount, processed_date. Endpoint: /v1/claim-retrievals. Payer: Cigna.',
  },
  {
    title: 'IV-4188 — member eligibility mismatch',
    text: 'A member with active coverage returns inactive. Member fields: member_id, subscriber_id, coverage_status, effective_date, plan_type. Payer: Guardian.',
  },
];

async function main(): Promise<void> {
  const port = process.env.ARBITER_API_PORT ?? '4311';
  // Empty env → offline: stub LLM + in-memory persistence, regardless of any local .env.
  const config = loadConfig({ ARBITER_API_PORT: port });
  const engine = createGuardrailEngine({ config });

  const now = nowIso();
  await engine.repos.projects.upsert(Project.parse({ id: PROJECT, name: 'Default Project', classification: 'internal', createdAt: now }));
  await engine.repos.users.upsert(User.parse({ id: ACTOR, email: 'qa@arbiter.local', role: 'qa', createdAt: now }));
  for (const d of SEED_DOCS) {
    const docId = newKnowledgeDocId();
    await engine.repos.knowledge.addDocument(
      { id: docId, projectId: PROJECT, title: d.title, sourceType: 'jira', citation: `k://${docId}`, classification: 'internal', createdAt: now },
      buildChunks(PROJECT, docId, d.text),
    );
  }
  await buildProjectGraph(engine.repos, PROJECT);

  // No `auth` → open dev mode; `/api/status.authEnabled` is false so the UI skips login.
  const app = buildServer({ engine, defaultProjectId: PROJECT, defaultActorId: ACTOR, logger: false });
  await app.listen({ port: Number(port), host: '127.0.0.1' });
  // eslint-disable-next-line no-console
  console.log(`E2E API (offline, no-auth) on http://127.0.0.1:${port}`);
}

main().catch((error) => {
  console.error('E2E API failed to start:', error);
  process.exitCode = 1;
});
