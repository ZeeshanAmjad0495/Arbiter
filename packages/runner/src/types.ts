import type { ExecutionCase, ExecutionStatus, ExecutionSummary, RunnerKind } from '@arbiter/core';

export interface RunRequest {
  readonly kind: RunnerKind;
  /** The test source (a Playwright spec or a k6 script). */
  readonly script: string;
  /** Human label for the run. */
  readonly name?: string;
}

/** The normalized result of executing one script — the shape both runners produce. */
export interface RunnerResult {
  readonly mode: 'real' | 'offline';
  readonly status: ExecutionStatus;
  readonly summary: ExecutionSummary;
  readonly cases: ExecutionCase[];
  /** Process exit code for a real run; null when offline (no process). */
  readonly exitCode: number | null;
  /** Runner-level failure (tool missing, timeout, unparseable output). */
  readonly error?: string;
}

/**
 * Executes an Arbiter-authored test with an industry tool and normalizes its
 * reporter output. Two implementations: `real` spawns the actual binary,
 * `offline` deterministically simulates it (no binary / CI / tests).
 */
export interface TestRunner {
  readonly mode: 'real' | 'offline';
  run(req: RunRequest): Promise<RunnerResult>;
}

/** Roll individual cases up into an overall summary + verdict. */
export function summarize(cases: ExecutionCase[], durationMs: number): { summary: ExecutionSummary; status: ExecutionStatus } {
  const passed = cases.filter((c) => c.status === 'passed').length;
  const failed = cases.filter((c) => c.status === 'failed').length;
  const skipped = cases.filter((c) => c.status === 'skipped').length;
  const summary: ExecutionSummary = { total: cases.length, passed, failed, skipped, durationMs };
  // No cases at all is an error (the tool produced nothing), not a pass.
  const status: ExecutionStatus = cases.length === 0 ? 'error' : failed > 0 ? 'failed' : 'passed';
  return { summary, status };
}
