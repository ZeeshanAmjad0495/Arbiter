import type { ExecutionCase } from '@arbiter/core';

// Strip ANSI colour codes (ESC [ … m) that Playwright embeds in error messages.
// Built from a char code so no literal control byte lives in the source.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/** Trim a failure message to a bounded, single-ish line — no ANSI, no full stack/script dump. */
function trimMessage(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  return raw.replace(ANSI, '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

/* ----------------------------- Playwright ----------------------------- *
 * `playwright test --reporter=json` emits { suites: [...] } where suites
 * nest and each spec carries its own pass/fail. We flatten specs → cases.  */

interface PwResult {
  status?: string;
  duration?: number;
  error?: { message?: string };
  errors?: { message?: string }[];
}
interface PwSpec {
  title?: string;
  ok?: boolean;
  tests?: { results?: PwResult[] }[];
}
interface PwSuite {
  title?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

function flattenPwSpecs(suite: PwSuite, prefix: string, out: ExecutionCase[]): void {
  const path = suite.title ? `${prefix}${prefix ? ' › ' : ''}${suite.title}` : prefix;
  for (const spec of suite.specs ?? []) {
    const result = spec.tests?.[0]?.results?.[0] ?? {};
    const rawStatus = result.status ?? (spec.ok ? 'passed' : 'failed');
    const status: ExecutionCase['status'] = rawStatus === 'passed' ? 'passed' : rawStatus === 'skipped' ? 'skipped' : 'failed';
    const message = trimMessage(result.error?.message ?? result.errors?.[0]?.message);
    out.push({
      name: path ? `${path} › ${spec.title ?? '(unnamed)'}` : (spec.title ?? '(unnamed)'),
      status,
      durationMs: typeof result.duration === 'number' ? result.duration : 0,
      ...(message ? { message } : {}),
    });
  }
  for (const child of suite.suites ?? []) flattenPwSpecs(child, path, out);
}

export function parsePlaywrightJson(stdout: string): ExecutionCase[] {
  const report = JSON.parse(stdout) as { suites?: PwSuite[] };
  const out: ExecutionCase[] = [];
  for (const suite of report.suites ?? []) flattenPwSpecs(suite, '', out);
  return out;
}

/* -------------------------------- k6 --------------------------------- *
 * `k6 run --summary-export=file` writes { root_group: { checks, groups } }.
 * Each check has name/passes/fails; a check with any fail is a failed case. */

interface K6Check {
  name?: string;
  passes?: number;
  fails?: number;
}
interface K6Group {
  checks?: K6Check[] | Record<string, K6Check>;
  groups?: Record<string, K6Group>;
}

function asCheckArray(checks: K6Check[] | Record<string, K6Check> | undefined): K6Check[] {
  if (!checks) return [];
  return Array.isArray(checks) ? checks : Object.values(checks);
}

function flattenK6(group: K6Group, out: ExecutionCase[]): void {
  for (const check of asCheckArray(group.checks)) {
    const fails = check.fails ?? 0;
    out.push({
      name: check.name ?? '(unnamed check)',
      status: fails > 0 ? 'failed' : 'passed',
      durationMs: 0, // per-check timing isn't in the summary; overall duration is set by the caller
      ...(fails > 0 ? { message: `${fails} of ${(check.passes ?? 0) + fails} iterations failed this check` } : {}),
    });
  }
  for (const child of Object.values(group.groups ?? {})) flattenK6(child, out);
}

export function parseK6Summary(json: string): ExecutionCase[] {
  const report = JSON.parse(json) as { root_group?: K6Group };
  const out: ExecutionCase[] = [];
  if (report.root_group) flattenK6(report.root_group, out);
  return out;
}
