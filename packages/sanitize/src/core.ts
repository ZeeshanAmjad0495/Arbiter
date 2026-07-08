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
 * Merge ALL overlapping matches into single spans and redact the UNION — so no
 * text that fell inside any recognizer match is ever emitted. (Fixes the leak
 * where dropping a lower-priority overlapping match left its non-overlapping
 * remainder raw.) The merged span's representative type is a credential if any
 * constituent is one (so it still hard-blocks), otherwise the highest-scoring
 * constituent (for the placeholder + de-mask mapping).
 */
export function mergeMatches(matches: readonly RawMatch[]): RawMatch[] {
  if (matches.length === 0) return [];
  const credRank = (t: SanitizationFindingType): number => (CREDENTIAL_TYPES.has(t) ? 1 : 0);
  const sorted = [...matches].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: RawMatch[] = [];
  let cur: RawMatch = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const m = sorted[i];
    if (m.start < cur.end) {
      const end = Math.max(cur.end, m.end);
      const takeM =
        credRank(m.type) > credRank(cur.type) || (credRank(m.type) === credRank(cur.type) && m.score > cur.score);
      cur = takeM ? { type: m.type, start: cur.start, end, score: m.score, engine: m.engine } : { ...cur, end };
    } else {
      merged.push(cur);
      cur = { ...m };
    }
  }
  merged.push(cur);
  return merged;
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
  engine: 'presidio' | 'regex' | 'regex-fallback',
  demask: DemaskStore,
  projectId?: string,
): Promise<SanitizationReport> {
  const matches = mergeMatches(rawMatches);
  // Belt-and-suspenders: a credential ANYWHERE in the raw matches blocks the
  // request, independent of the merge outcome.
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
      placeholder = await demask.put(m.type, text.slice(m.start, m.end), projectId);
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
    // Hash the SANITIZED text (not raw) for audit correlation — a raw hash of a
    // low-entropy PHI value (e.g. a lone SSN) would be brute-forceable.
    originalSha256: sha256Hex(out),
  });
}
