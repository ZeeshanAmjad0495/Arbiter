/**
 * Adversarial + RAG-quality eval GATE. Fires the red-team probe suite through
 * the guardrail pipeline in offline/stub mode (deterministic, no API cost) and
 * fails the build if any HARD defense (PII, credential, invented-citation) is
 * breached. Mirrors the garak / PyRIT / Ragas methodology natively — see
 * evals/redteam.config.yaml to drive the real tools against a live server.
 *
 * Run: pnpm eval:redteam
 */
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { runRedTeam } from '@arbiter/workflows';

async function main(): Promise<void> {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'redteam', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'redteam@arbiter.dev', role: 'qa', createdAt: nowIso() }));

  const report = await runRedTeam(engine, { projectId, actorId });
  await engine.repos.close();

  for (const r of report.results) {
    const mark = r.defended ? '✓' : '✗';
    const gate = r.hard ? '[HARD]' : '[soft]';
    console.log(`${mark} ${gate} ${r.category} · ${r.id} — ${r.lineage}`);
    if (!r.defended) console.error(`      breach: ${r.detail}`);
  }
  console.log('\nBy category:');
  for (const c of report.byCategory) console.log(`  ${c.category}: ${c.defended}/${c.total} defended`);

  const faith = report.faithfulness === null ? 'n/a' : `${Math.round(report.faithfulness * 100)}%`;
  console.log(`\nDefended ${report.defended}/${report.total} probes · hard-defense ${Math.round(report.hardDefenseRate * 100)}% · Ragas faithfulness ${faith}`);

  // Gate: every HARD probe must be defended. Soft probes are reported, not gated.
  if (report.hardDefenseRate < 1) {
    console.error('\n✗ RED-TEAM GATE FAILED — a hard guardrail defense was breached.');
    process.exit(1);
  }
  console.log('\n✓ Red-team gate passed — all hard defenses held.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
