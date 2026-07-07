import type { ArbiterConfig } from '@arbiter/config';
import type { SanitizationReport } from '@arbiter/core';
import { type RawMatch, runRecognizers, sanitizeCore } from './core';
import { createDemaskStore, type DemaskStore } from './demask';
import { analyzeWithPresidio } from './presidio';
import { CUSTOM_RECOGNIZERS, REGEX_RECOGNIZERS } from './recognizers';

export * from './demask';
export * from './recognizers';
export { CREDENTIAL_TYPES, dedupeMatches, runRecognizers, sanitizeCore, type RawMatch } from './core';

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
    let matches: RawMatch[];
    try {
      const presidio = await analyzeWithPresidio(text, this.analyzerUrl);
      // Always layer in the custom recognizers (member IDs, secrets, internal URLs)
      // that Presidio's defaults miss.
      const custom = runRecognizers(text, CUSTOM_RECOGNIZERS);
      matches = [...presidio, ...custom];
    } catch {
      // Fail safe: if the sidecar is unreachable, fall back to the full regex set
      // rather than sending unsanitized text.
      matches = runRecognizers(text, REGEX_RECOGNIZERS);
      return sanitizeCore(text, matches, 'regex', this.demask);
    }
    return sanitizeCore(text, matches, 'presidio', this.demask);
  }
}

export function createSanitizer(config: ArbiterConfig, demask: DemaskStore = createDemaskStore(config)): SanitizePort {
  if (config.sanitizer === 'presidio' && config.env.PRESIDIO_ANALYZER_URL) {
    return new PresidioSanitizer(demask, config.env.PRESIDIO_ANALYZER_URL);
  }
  return new RegexSanitizer(demask);
}
