/**
 * Zuub end-to-end RUN against a REAL LLM.
 *
 * Boots the production HTTP server (buildServer) wired to the configured real LLM
 * provider and drives the full guardrail pipeline (RAG + GraphRAG → sanitize → ground
 * → generate → validate → gate) for EVERY Zuub ticket through EVERY one of the 39
 * workflows — a 12 × 39 = 468-run matrix. Unlike `pnpm test` (offline, deterministic,
 * CI-safe), this makes real model calls, so it is a manual pre-audit run, not part of CI.
 *
 * Usage: pnpm zuub:e2e            (full 468-run matrix)
 *        pnpm zuub:e2e --smoke    (one run, to check the provider is reachable)
 *
 * Writes evals/reports/zuub-e2e-report.md and .json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { listWorkflowsMeta } from '@arbiter/workflows';
import { buildServer } from '../apps/api/src/server';
import { ZUUB_TICKETS } from '../tests/fixtures/zuub-tickets';

// Kimi Tier-2 limits: concurrency 100, RPM 500, TPM 3M. We run 40 in flight (slow
// generations overlap) and space request STARTS ≥130ms apart (~460 RPM) so we stay
// under the RPM cap even if some responses come back fast.
const CONCURRENCY = 40;
const MIN_REQUEST_INTERVAL_MS = 130;
// Kimi is slow on the heaviest workflows (p95 ≈ 83s, tail > 90s), so give each run
// generous headroom — the throttle + concurrency cap keep us within the rate limits.
const RUN_TIMEOUT_MS = 240_000;
const smokeOnly = process.argv.includes('--smoke');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastReqAt = 0;
/** Global request-start throttle to keep RPM under the provider cap. */
async function rateGate(): Promise<void> {
  const now = Date.now();
  const scheduled = Math.max(now, lastReqAt + MIN_REQUEST_INTERVAL_MS);
  lastReqAt = scheduled;
  if (scheduled > now) await sleep(scheduled - now);
}

interface RunResult {
  flow: string;
  ticket: string;
  ok: boolean;
  blocked?: boolean;
  decision?: string;
  groundingViolations?: number;
  findings?: number;
  model?: string;
  outputChars?: number;
  ms: number;
  error?: string;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error(`timeout after ${ms}ms: ${label}`)), ms)));
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

async function pool<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
      done++;
      if (done % 20 === 0 || done === items.length) process.stdout.write(`  …${done}/${items.length} runs\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main(): Promise<void> {
  process.loadEnvFile?.('.env');
  // Keep the real LLM provider + keys from .env, but isolate the run in an ephemeral
  // in-memory store so it never touches (or pollutes) the real database. Deleting from
  // process.env itself guarantees every config read (ours or internal) selects memory.
  delete process.env.DATABASE_URL;
  const config = loadConfig();
  if (config.llm === 'stub') {
    console.error('✗ No real LLM provider configured. Set KIMI_API_KEY, ANTHROPIC_API_KEY or LITELLM_API_KEY in .env.');
    process.exit(1);
  }
  console.log(`Persistence: ${config.persistence} (ephemeral run)`);
  console.log(`Provider: ${config.llm} · models: draft=${config.models.draft} default=${config.models.default} judge=${config.models.judge}\n`);

  const engine = createGuardrailEngine({ config });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'Zuub E2E', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'e2e@zuub.test', role: 'qa', createdAt: nowIso() }));
  const app = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, logger: false });
  await app.ready();

  const run = (flow: string, requirement: string, riskTier: string) =>
    app.inject({ method: 'POST', url: `/v1/workflows/${flow}/run`, payload: { requirement, riskTier, useKnowledge: true, useGraph: true } });

  // Ingest the corpus + build the graph so RAG/GraphRAG have something to retrieve.
  console.log('Ingesting Zuub corpus + building graph…');
  for (const t of ZUUB_TICKETS) {
    await app.inject({ method: 'POST', url: '/v1/knowledge', payload: { title: `${t.key} — ${t.title}`, content: t.content, sourceType: 'jira', classification: 'internal' } });
  }
  await app.inject({ method: 'POST', url: '/v1/graph/build' });

  const flows = listWorkflowsMeta().map((m) => m.id);
  console.log(`Flows: ${flows.length} · tickets: ${ZUUB_TICKETS.length}\n`);

  // Smoke: one real call to confirm the provider is reachable before the full matrix.
  console.log('Smoke run (bug-report × IV-4101)…');
  const smoke = await withTimeout(run('bug-report', ZUUB_TICKETS[0]!.content, 'low'), RUN_TIMEOUT_MS, 'smoke').catch((e) => ({ statusCode: 0, error: String(e) }) as never);
  if ((smoke as { statusCode: number }).statusCode !== 200) {
    console.error(`✗ Smoke failed (${(smoke as { statusCode?: number }).statusCode}). Provider not reachable / model invalid.`);
    console.error(JSON.stringify((smoke as { json?: () => unknown }).json?.() ?? (smoke as { error?: string }).error, null, 2).slice(0, 800));
    await app.close();
    process.exit(1);
  }
  const smokeBody = (smoke as { json: () => { model: string } }).json();
  console.log(`✓ Smoke ok — real model reported: ${smokeBody.model}\n`);
  if (smokeOnly) {
    await app.close();
    return;
  }

  // Full matrix: every ticket × every flow.
  const pairs = flows.flatMap((flow) => ZUUB_TICKETS.map((t) => ({ flow, t })));
  console.log(`Running ${pairs.length} real-LLM cases (concurrency ${CONCURRENCY})…`);
  const started = Date.now();
  const attempt = async (flow: string, t: (typeof ZUUB_TICKETS)[number]): Promise<RunResult> => {
    await rateGate();
    const start = Date.now();
    const res = await withTimeout(run(flow, t.content, t.riskTier), RUN_TIMEOUT_MS, `${flow}×${t.key}`);
    const ms = Date.now() - start;
    if (res.statusCode !== 200) return { flow, ticket: t.key, ok: false, ms, error: `HTTP ${res.statusCode}` };
    const b = res.json() as {
      sanitization: { blocked: boolean; findings: unknown[] };
      review?: { decision: string };
      grounding?: { violations: number };
      output: unknown;
      model: string;
    };
    return {
      flow,
      ticket: t.key,
      ok: true,
      blocked: b.sanitization.blocked,
      decision: b.review?.decision,
      groundingViolations: b.grounding?.violations,
      findings: b.sanitization.findings.length,
      model: b.model,
      outputChars: b.output ? JSON.stringify(b.output).length : 0,
      ms,
    };
  };
  const results = await pool(pairs, CONCURRENCY, async ({ flow, t }): Promise<RunResult> => {
    try {
      return await attempt(flow, t);
    } catch {
      try {
        return await attempt(flow, t); // one retry absorbs a transient hang / 429
      } catch (e) {
        return { flow, ticket: t.key, ok: false, ms: 0, error: e instanceof Error ? e.message : String(e) };
      }
    }
  });
  const wallMs = Date.now() - started;
  await app.close();

  report(results, { provider: config.llm, model: smokeBody.model, wallMs, flows });
}

function report(results: RunResult[], meta: { provider: string; model: string; wallMs: number; flows: string[] }): void {
  const ok = results.filter((r) => r.ok);
  const errors = results.filter((r) => !r.ok);
  const blocked = ok.filter((r) => r.blocked);
  const withViolations = ok.filter((r) => (r.groundingViolations ?? 0) > 0);
  const models = [...new Set(ok.map((r) => r.model))];
  const decisions = ok.reduce<Record<string, number>>((a, r) => ((a[r.decision ?? '—'] = (a[r.decision ?? '—'] ?? 0) + 1), a), {});
  const avgMs = ok.length ? Math.round(ok.reduce((s, r) => s + r.ms, 0) / ok.length) : 0;

  // Per-flow rollup.
  const byFlow = meta.flows.map((flow) => {
    const rows = results.filter((r) => r.flow === flow);
    return { flow, total: rows.length, ok: rows.filter((r) => r.ok).length, errors: rows.filter((r) => !r.ok).length };
  });

  const lines: string[] = [];
  lines.push(`# Zuub E2E — real-LLM run`);
  lines.push('');
  lines.push(`- Provider: **${meta.provider}** · model(s) actually used: **${models.join(', ') || '—'}**`);
  lines.push(`- Cases: **${results.length}** (${meta.flows.length} flows × ${ZUUB_TICKETS.length} tickets)`);
  lines.push(`- Succeeded: **${ok.length}** · Errored: **${errors.length}**`);
  lines.push(`- Sanitizer hard-blocked (credential ticket): **${blocked.length}** · Grounding violations: **${withViolations.length}**`);
  lines.push(`- Gate decisions: ${Object.entries(decisions).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  lines.push(`- Avg latency/run: **${avgMs}ms** · Wall time: **${(meta.wallMs / 1000).toFixed(1)}s**`);
  lines.push('');
  lines.push(`## Per-flow`);
  lines.push('');
  lines.push(`| Flow | ok/total | errors |`);
  lines.push(`| --- | --- | --- |`);
  for (const f of byFlow) lines.push(`| ${f.flow} | ${f.ok}/${f.total} | ${f.errors} |`);
  if (errors.length) {
    lines.push('');
    lines.push(`## Errors (${errors.length})`);
    lines.push('');
    for (const e of errors.slice(0, 60)) lines.push(`- ${e.flow} × ${e.ticket}: ${e.error}`);
  }

  mkdirSync('evals/reports', { recursive: true });
  writeFileSync('evals/reports/zuub-e2e-report.md', lines.join('\n'));
  writeFileSync('evals/reports/zuub-e2e-report.json', JSON.stringify({ meta: { ...meta, ranAt: nowIso() }, results }, null, 2));

  console.log('\n' + lines.slice(0, 10).join('\n'));
  console.log(`\nReport → evals/reports/zuub-e2e-report.md`);
  if (errors.length > results.length * 0.1) {
    console.error(`\n✗ ${errors.length}/${results.length} runs failed (>10%).`);
    process.exit(1);
  }
  console.log(`\n✓ Zuub real-LLM E2E complete — ${ok.length}/${results.length} runs succeeded.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
