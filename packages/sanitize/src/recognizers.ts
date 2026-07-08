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
  // Stripe secret / restricted keys use underscores (sk_live_…, sk_test_…, rk_live_…),
  // so the sk- pattern above misses them — a live Stripe key would otherwise pass through.
  { type: 'API_KEY', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g, score: 0.97 },
  { type: 'API_KEY', pattern: /\bAKIA[0-9A-Z]{16}\b/g, score: 0.95 },
  { type: 'API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, score: 0.9 },
  { type: 'API_KEY', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, score: 0.95 },
  { type: 'API_KEY', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, score: 0.9 },
  { type: 'PASSWORD', pattern: /(?:password|passwd|pwd)\s*[:=]\s*(\S+)/gi, score: 0.85, group: 1 },
  { type: 'GENERIC_SECRET', pattern: /(?:secret|token|api[_-]?key)\s*[:=]\s*(\S+)/gi, score: 0.8, group: 1 },
  // URL-embedded basic-auth credentials, e.g. postgresql://user:pass@host.
  { type: 'GENERIC_SECRET', pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/:@]+@/gi, score: 0.9 },
  // Bearer / opaque authorization tokens.
  { type: 'API_KEY', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/g, score: 0.85 },
  // Domain identifiers. Require a digit in the id body so English words like
  // "member_email"/"member_status" (schema column names) are not redacted as
  // member ids — real member ids (MEM123456, MEMBER-A1B2C3) always contain digits.
  { type: 'MEMBER_ID', pattern: /\b(?:MEM|MBR|MEMBER)[-_]?(?=[A-Z0-9]{5,}\b)[A-Z0-9]*\d[A-Z0-9]*\b/gi, score: 0.7 },
  { type: 'MEMBER_ID', pattern: /\bmember(?:\s*id)?\s*[:#]\s*([A-Z0-9-]{5,})\b/gi, score: 0.75, group: 1 },
  // Internal infrastructure references.
  {
    type: 'INTERNAL_URL',
    pattern: /\bhttps?:\/\/[A-Za-z0-9.-]*(?:internal|corp|intranet|\.local|\.lan|localhost)[^\s"'<>]*/gi,
    score: 0.7,
  },
  // --- Locale-aware PII (non-US member data). Well-anchored + validated to keep
  // false positives low; mapped to OTHER where the US-centric taxonomy has no slot.
  // These run in both engine paths, so coverage never depends on Presidio locale. ---
  // E.164 international phone numbers (leading +, 8–15 digits).
  {
    type: 'PHONE_NUMBER',
    pattern: /\+\d(?:[\s.-]?\d){7,14}\b/g,
    score: 0.6,
    validate: (m) => {
      const d = m.replace(/\D/g, '');
      return d.length >= 8 && d.length <= 15;
    },
  },
  // IBAN (ISO 13616): 2-letter country + 2 check digits + up to 30 alphanumerics.
  {
    type: 'OTHER',
    pattern: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g,
    score: 0.75,
    validate: (m) => /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(m.replace(/\s/g, '')),
  },
  // UK National Insurance Number (NINO) — standard prefix-letter exclusions.
  {
    type: 'OTHER',
    pattern: /\b[ABCEGHJ-PRSTW-Z][ABCEGHJ-NPRSTW-Z]\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g,
    score: 0.8,
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
