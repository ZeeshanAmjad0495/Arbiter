import { type SanitizationFindingType, SanitizationReport, sha256Hex } from '@arbiter/core';
import type { DemaskStore } from './demask';
import type { Recognizer } from './recognizers';

export interface RawMatch {
  readonly type: SanitizationFindingType;
  readonly start: number;
  readonly end: number;
  readonly score: number;
  readonly engine: 'presidio' | 'regex';
}

/** Types that must NEVER be sent to a model — detection hard-blocks the request. */
export const CREDENTIAL_TYPES: ReadonlySet<SanitizationFindingType> = new Set([
  'API_KEY',
  'JWT',
  'PASSWORD',
  'GENERIC_SECRET',
]);

/** Collect matches from a recognizer set over `text`. */
export function runRecognizers(text: string, recognizers: readonly Recognizer[]): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const rec of recognizers) {
    // Clone the regex to reset lastIndex and guarantee the global flag.
    const flags = rec.pattern.flags.includes('g') ? rec.pattern.flags : rec.pattern.flags + 'g';
    const re = new RegExp(rec.pattern.source, flags);
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      const whole = m[0];
      if (rec.validate && !rec.validate(whole)) continue;
      if (rec.group !== undefined) {
        const captured = m[rec.group];
        if (captured === undefined || captured.length === 0) continue;
        const offset = whole.indexOf(captured);
        const start = m.index + (offset < 0 ? 0 : offset);
        matches.push({ type: rec.type, start, end: start + captured.length, score: rec.score, engine: 'regex' });
      } else {
        matches.push({ type: rec.type, start: m.index, end: m.index + whole.length, score: rec.score, engine: 'regex' });
      }
    }
  }
  return matches;
}

/**
 * Resolve overlapping matches by PRIORITY, not position: credentials first, then
 * higher score, then longer span. A match is kept only if it does not overlap any
 * already-kept match. This guarantees a credential is never suppressed by an
 * overlapping non-credential match (e.g. an INTERNAL_URL that engulfs a JWT in its
 * query string) — the bug that would otherwise defeat the credential hard-block.
 */
export function dedupeMatches(matches: readonly RawMatch[]): RawMatch[] {
  const credRank = (m: RawMatch): number => (CREDENTIAL_TYPES.has(m.type) ? 1 : 0);
  const ordered = [...matches].sort(
    (a, b) => credRank(b) - credRank(a) || b.score - a.score || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const kept: RawMatch[] = [];
  for (const m of ordered) {
    const overlaps = kept.some((k) => m.start < k.end && k.start < m.end);
    if (!overlaps) kept.push(m);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

/**
 * The shared redaction algorithm used by both the regex and Presidio sanitizers.
 * Replaces each match with a stable placeholder, records reversible PII mappings
 * in the de-masking store, and hard-blocks (without persisting the secret) when a
 * credential is found.
 */
export async function sanitizeCore(
  text: string,
  rawMatches: readonly RawMatch[],
  engine: 'presidio' | 'regex',
  demask: DemaskStore,
): Promise<SanitizationReport> {
  const matches = dedupeMatches(rawMatches);
  // Belt-and-suspenders: a credential ANYWHERE in the raw matches blocks the
  // request, independent of what survived dedupe.
  const hasRawCredential = rawMatches.some((m) => CREDENTIAL_TYPES.has(m.type));
  const findings: SanitizationReport['findings'] = [];
  const blockReasons: string[] = [];
  let blocked = hasRawCredential;
  let out = '';
  let cursor = 0;

  for (const m of matches) {
    out += text.slice(cursor, m.start);
    const isCredential = CREDENTIAL_TYPES.has(m.type);
    let placeholder: string;
    if (isCredential) {
      // Credentials are never stored — no reversible mapping, ever.
      placeholder = `[${m.type}_REDACTED]`;
      blocked = true;
      blockReasons.push(`Detected ${m.type}. Request blocked — rotate the exposed secret immediately.`);
    } else {
      // The store allocates a globally-unique placeholder (no cross-call collisions).
      placeholder = await demask.put(m.type, text.slice(m.start, m.end));
    }
    out += placeholder;
    cursor = m.end;
    findings.push({ type: m.type, start: m.start, end: m.end, placeholder, score: m.score, engine: m.engine });
  }
  out += text.slice(cursor);

  if (blocked && blockReasons.length === 0) {
    blockReasons.push('Detected a credential. Request blocked — rotate the exposed secret immediately.');
  }

  return SanitizationReport.parse({
    engine,
    sanitizedText: out,
    findings,
    blocked,
    blockReasons,
    originalSha256: sha256Hex(text),
  });
}
