import { createHash } from 'node:crypto';

/** sha256 hex digest — used to correlate audit events to inputs without storing the input. */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Single clock seam so tests can inject deterministic time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function nowIso(clock: Clock = systemClock): string {
  return clock.now().toISOString();
}

/**
 * Minimal line-level unified diff (LCS-based, dependency-free). Used to capture a
 * reviewer's edits to a generated artifact — the raw signal for the feedback
 * flywheel. Prefix `  ` = unchanged, `- ` = removed, `+ ` = added.
 */
export function unifiedDiff(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push(`  ${a[i]}`);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push(`- ${a[i]}`);
      i++;
    } else {
      out.push(`+ ${b[j]}`);
      j++;
    }
  }
  while (i < n) out.push(`- ${a[i++]}`);
  while (j < m) out.push(`+ ${b[j++]}`);
  return out.join('\n');
}
