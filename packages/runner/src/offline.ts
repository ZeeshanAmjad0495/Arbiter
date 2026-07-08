import type { ExecutionCase, RunnerKind } from '@arbiter/core';
import { type RunRequest, type RunnerResult, type TestRunner, summarize } from './types';

/** Deterministic pseudo-duration from a name — no Date/random, so runs are reproducible. */
function fauxDuration(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return 20 + h; // 20–1016ms
}

/** A case "fails" offline iff its name hints at failure — lets fixtures assert both paths. */
const FAIL_HINT = /\b(fail|failing|broken|bug|todo|regress|breach)\b/i;

/** Playwright: `test('title', …)`, plus `.skip`/`.only`. Describe blocks are ignored. */
function parsePlaywrightCases(script: string): ExecutionCase[] {
  const re = /\btest(\.skip|\.only|\.fixme)?\s*\(\s*(['"`])([^'"`]+?)\2/g;
  const cases: ExecutionCase[] = [];
  for (let m = re.exec(script); m !== null; m = re.exec(script)) {
    const skipped = m[1] === '.skip' || m[1] === '.fixme';
    const name = m[3]!;
    cases.push({
      name,
      status: skipped ? 'skipped' : FAIL_HINT.test(name) ? 'failed' : 'passed',
      durationMs: skipped ? 0 : fauxDuration(name),
      ...(FAIL_HINT.test(name) && !skipped ? { message: 'Simulated assertion failure (offline runner)' } : {}),
    });
  }
  return cases;
}

/** k6: the string keys of a `check(res, { 'status is 200': (r) => … })` object. */
function parseK6Cases(script: string): ExecutionCase[] {
  const re = /(['"])([^'"]{2,100}?)\1\s*:\s*(?:\([^)]*\)|function)/g;
  const cases: ExecutionCase[] = [];
  for (let m = re.exec(script); m !== null; m = re.exec(script)) {
    const name = m[2]!;
    cases.push({
      name,
      status: FAIL_HINT.test(name) ? 'failed' : 'passed',
      durationMs: fauxDuration(name),
      ...(FAIL_HINT.test(name) ? { message: 'Simulated check failure (offline runner)' } : {}),
    });
  }
  return cases;
}

export function parseCasesOffline(kind: RunnerKind, script: string): ExecutionCase[] {
  return kind === 'playwright' ? parsePlaywrightCases(script) : parseK6Cases(script);
}

/**
 * Deterministic stand-in for the real tool. It statically reads the script's
 * test/check declarations and reports them as an execution, so the whole
 * author → run → metrics loop works with no binaries installed. Every result is
 * clearly stamped `mode: 'offline'` so it is never mistaken for a live run.
 */
export class OfflineTestRunner implements TestRunner {
  readonly mode = 'offline' as const;

  async run(req: RunRequest): Promise<RunnerResult> {
    const cases = parseCasesOffline(req.kind, req.script);
    const durationMs = cases.reduce((sum, c) => sum + c.durationMs, 0);
    const { summary, status } = summarize(cases, durationMs);
    return { mode: 'offline', status, summary, cases, exitCode: null };
  }
}
