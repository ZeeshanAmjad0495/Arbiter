import { getConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { renderTrace } from '@arbiter/telemetry';
import { runHello } from '../hello';

/**
 * Phase 0 exit-criterion demo. Runs the hello-world workflow end-to-end and
 * shows the three things the plan requires: a sanitization pass, an audit event,
 * and a trace. Modes:
 *   pnpm hello              clean run (PII redacted, output grounded, approved)
 *   pnpm hello ungrounded   inject a fabricated field -> grounding blocks export
 *   pnpm hello blocked      input contains a live secret -> hard block, no model call
 */
function loadEnv(): void {
  try {
    (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env');
  } catch {
    /* no .env file — offline defaults apply */
  }
}

function h(title: string): void {
  console.log(`\n[1m${title}[0m`);
}

async function main(): Promise<void> {
  loadEnv();
  const mode = process.argv[2] ?? 'clean';
  const config = getConfig();
  const engine = createGuardrailEngine();

  const now = nowIso();
  const project = Project.parse({ id: newProjectId(), name: 'Demo Project (Zuub)', classification: 'confidential', createdAt: now });
  const actor = User.parse({ id: newUserId(), email: 'qa@arbisoft.com', role: 'qa', createdAt: now });
  await engine.repos.projects.upsert(project);
  await engine.repos.users.upsert(actor);

  h('Arbiter — Phase 0 hello-world');
  console.log(
    `mode=${mode}  persistence=${config.persistence}  sanitizer=${config.sanitizer}  ` +
      `llm=${config.llm}  telemetry=${config.telemetry}  demask=${config.demask}`,
  );

  const outcome = await runHello(engine, {
    projectId: project.id,
    actorId: actor.id,
    autoApprove: mode === 'clean',
    injectUngroundedField: mode === 'ungrounded',
    ...(mode === 'blocked'
      ? { requirement: 'Login smoke test using api key sk-ABCDEF0123456789ABCDEF for user a@b.com.' }
      : {}),
  });

  h('1) Sanitization pass');
  console.log(`engine=${outcome.sanitization.engine}  blocked=${outcome.sanitization.blocked}  findings=${outcome.sanitization.findings.length}`);
  for (const f of outcome.sanitization.findings) {
    console.log(`   • ${f.type.padEnd(14)} -> ${f.placeholder}  (score ${f.score.toFixed(2)}, ${f.engine})`);
  }
  if (outcome.sanitization.blocked) {
    for (const r of outcome.sanitization.blockReasons) console.log(`   ! ${r}`);
  }
  console.log(`   sanitized: ${outcome.sanitization.sanitizedText}`);

  h('2) Generated artifact');
  if (outcome.output) {
    console.log(JSON.stringify(outcome.output, null, 2));
  } else {
    console.log('   (no artifact — run short-circuited before the model call)');
  }

  h('3) Grounding validation');
  console.log(`violations=${outcome.grounding.violations}  blockedExport=${outcome.grounding.blockedExport}`);
  for (const c of outcome.grounding.claims) {
    console.log(`   • ${c.kind}:${c.value.padEnd(16)} ${c.status}${c.foundIn ? ` (in ${c.foundIn})` : ''}`);
  }

  h('4) Review gate');
  console.log(`decision=${outcome.review.decision}  mode=${outcome.review.mode}  risk=${outcome.review.riskTier}`);

  h('5) Audit trail (persisted)');
  const persisted = await engine.repos.audit.listByRun(project.id, outcome.runId);
  console.log(`runId=${outcome.runId}`);
  console.log(`events=${persisted.length}: ${persisted.map((e) => e.action).join(' -> ')}`);

  h('6) Trace');
  for (const root of engine.tracer.roots) {
    console.log(renderTrace(root));
  }

  await engine.repos.close();
  console.log('\n[32m✓ hello-world completed: sanitization pass + audit events + trace emitted.[0m');
}

main().catch((error) => {
  console.error('[31mhello-world failed:[0m', error);
  process.exitCode = 1;
});
