import type { SanitizationFindingType } from '@arbiter/core';

export interface Recognizer {
  readonly type: SanitizationFindingType;
  readonly pattern: RegExp; // MUST be global (/g)
  readonly score: number;
  /** Optional secondary check (e.g. Luhn) to cut false positives. */
  readonly validate?: (match: string) => boolean;
  /** If set, redact this capture group instead of the whole match (e.g. the value after "password:"). */
  readonly group?: number;
}

/** Luhn checksum — rejects random digit runs mis-flagged as credit cards. */
export function luhnValid(raw: string): boolean {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/**
 * Custom recognizers for things Presidio's defaults miss and that matter in the
 * QA/healthcare-adjacent domain (member IDs, secrets, internal hostnames).
 * These run in BOTH the regex-only and Presidio paths so coverage never depends
 * on which engine is active.
 */
export const CUSTOM_RECOGNIZERS: readonly Recognizer[] = [
  // Secrets / credentials (these trigger the hard block).
  { type: 'JWT', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, score: 0.99 },
  { type: 'API_KEY', pattern: /\bsk-[A-Za-z0-9]{20,}\b/g, score: 0.95 },
  { type: 'API_KEY', pattern: /\bAKIA[0-9A-Z]{16}\b/g, score: 0.95 },
  { type: 'API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, score: 0.9 },
  { type: 'API_KEY', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, score: 0.95 },
  { type: 'API_KEY', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, score: 0.9 },
  { type: 'PASSWORD', pattern: /(?:password|passwd|pwd)\s*[:=]\s*(\S+)/gi, score: 0.85, group: 1 },
  { type: 'GENERIC_SECRET', pattern: /(?:secret|token|api[_-]?key)\s*[:=]\s*(\S+)/gi, score: 0.8, group: 1 },
  // Domain identifiers.
  { type: 'MEMBER_ID', pattern: /\b(?:MEM|MBR|MEMBER)[-_]?[A-Z0-9]{5,}\b/gi, score: 0.7 },
  { type: 'MEMBER_ID', pattern: /\bmember(?:\s*id)?\s*[:#]\s*([A-Z0-9-]{5,})\b/gi, score: 0.75, group: 1 },
  // Internal infrastructure references.
  {
    type: 'INTERNAL_URL',
    pattern: /\bhttps?:\/\/[A-Za-z0-9.-]*(?:internal|corp|intranet|\.local|\.lan|localhost)[^\s"'<>]*/gi,
    score: 0.7,
  },
] as const;

/** Standard PII recognizers used when Presidio is not available. */
export const STANDARD_RECOGNIZERS: readonly Recognizer[] = [
  { type: 'EMAIL_ADDRESS', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, score: 0.9 },
  { type: 'US_SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, score: 0.85 },
  { type: 'CREDIT_CARD', pattern: /\b(?:\d[ -]?){13,19}\b/g, score: 0.9, validate: luhnValid },
  { type: 'PHONE_NUMBER', pattern: /\b(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, score: 0.6 },
  { type: 'IP_ADDRESS', pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g, score: 0.6 },
] as const;

export const REGEX_RECOGNIZERS: readonly Recognizer[] = [...STANDARD_RECOGNIZERS, ...CUSTOM_RECOGNIZERS];
