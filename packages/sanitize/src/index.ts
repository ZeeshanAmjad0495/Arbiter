import type { ArbiterConfig } from '@arbiter/config';
import type { SanitizationReport } from '@arbiter/core';
import { type RawMatch, runRecognizers, sanitizeCore } from './core';
import { createDemaskStore, type DemaskStore } from './demask';
import { analyzeWithPresidio } from './presidio';
import { CUSTOM_RECOGNIZERS, REGEX_RECOGNIZERS } from './recognizers';

export * from './demask';
export * from './recognizers';
export { CREDENTIAL_TYPES, mergeMatches, runRecognizers, sanitizeCore, type RawMatch } from './core';

/**
 * The one interface the guardrail pipeline depends on. `sanitize()` returns a
 * report; the caller decides whether `blocked` aborts the run.
 */
export interface SanitizePort {
  readonly engine: 'presidio' | 'regex';
  readonly demask: DemaskStore;
  sanitize(text: string): Promise<SanitizationReport>;
}

class RegexSanitizer implements SanitizePort {
  readonly engine = 'regex' as const;
  constructor(readonly demask: DemaskStore) {}
  async sanitize(text: string): Promise<SanitizationReport> {
    const matches = runRecognizers(text, REGEX_RECOGNIZERS);
    return sanitizeCore(text, matches, 'regex', this.demask);
  }
}

class PresidioSanitizer implements SanitizePort {
  readonly engine = 'presidio' as const;
  constructor(
    readonly demask: DemaskStore,
    private readonly analyzerUrl: string,
  ) {}
  async sanitize(text: string): Promise<SanitizationReport> {
    try {
      const presidio = await analyzeWithPresidio(text, this.analyzerUrl);
      // Always layer in the custom recognizers (member IDs, secrets, internal URLs)
      // that Presidio's defaults miss.
      const custom = runRecognizers(text, CUSTOM_RECOGNIZERS);
      return sanitizeCore(text, [...presidio, ...custom], 'presidio', this.demask);
    } catch (error) {
      // Fail safe, but LOUD and DISTINGUISHABLE: a silent downgrade of PHI
      // protection is a security event, not a warning. `regex-fallback` is
      // separate from a configured regex deployment so monitoring can alert.
      // eslint-disable-next-line no-console
      console.error(
        `[sanitize] Presidio unreachable at ${this.analyzerUrl} — DEGRADED to regex-fallback (weaker PHI coverage): ${error instanceof Error ? error.message : String(error)}`,
      );
      const matches = runRecognizers(text, REGEX_RECOGNIZERS);
      return sanitizeCore(text, matches, 'regex-fallback', this.demask);
    }
  }
}

export function createSanitizer(config: ArbiterConfig, demask: DemaskStore = createDemaskStore(config)): SanitizePort {
  if (config.sanitizer === 'presidio' && config.env.PRESIDIO_ANALYZER_URL) {
    return new PresidioSanitizer(demask, config.env.PRESIDIO_ANALYZER_URL);
  }
  return new RegexSanitizer(demask);
}

/**
 * Recursively sanitize the string leaves of an arbitrary JSON value — used to
 * scrub reviewer edits and retrieved context so raw PHI never reaches storage
 * or the model even when it enters outside the primary input.
 */
export async function sanitizeJson(value: unknown, sanitizer: SanitizePort): Promise<unknown> {
  if (typeof value === 'string') return (await sanitizer.sanitize(value)).sanitizedText;
  if (Array.isArray(value)) return Promise.all(value.map((v) => sanitizeJson(v, sanitizer)));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = await sanitizeJson(v, sanitizer);
    return out;
  }
  return value;
}
