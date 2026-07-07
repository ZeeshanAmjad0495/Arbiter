import type { SanitizationFindingType } from '@arbiter/core';
import type { RawMatch } from './core';

interface PresidioResult {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

const ENTITY_MAP: Record<string, SanitizationFindingType> = {
  PERSON: 'PERSON',
  EMAIL_ADDRESS: 'EMAIL_ADDRESS',
  PHONE_NUMBER: 'PHONE_NUMBER',
  US_SSN: 'US_SSN',
  CREDIT_CARD: 'CREDIT_CARD',
  IP_ADDRESS: 'IP_ADDRESS',
  URL: 'INTERNAL_URL',
  DATE_TIME: 'DATE_OF_BIRTH',
  IBAN_CODE: 'GENERIC_SECRET',
};

/** Calls the Presidio analyzer sidecar and maps its entities into RawMatch. */
export async function analyzeWithPresidio(text: string, analyzerUrl: string, timeoutMs = 8000): Promise<RawMatch[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${analyzerUrl.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, language: 'en' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Presidio analyzer returned ${res.status}`);
    }
    const results = (await res.json()) as PresidioResult[];
    return results.map((r) => ({
      type: ENTITY_MAP[r.entity_type] ?? 'OTHER',
      start: r.start,
      end: r.end,
      score: r.score,
      engine: 'presidio' as const,
    }));
  } finally {
    clearTimeout(timer);
  }
}
