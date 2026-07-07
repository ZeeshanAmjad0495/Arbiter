import { CUSTOM_RECOGNIZERS, type Recognizer } from './recognizers';

/**
 * Emit Arbiter's custom recognizers in Microsoft Presidio's pattern-recognizer
 * config shape, so the SAME recognizers can be loaded into a Presidio analyzer
 * SERVER (centralized PHI tuning) instead of only running app-side. Operators
 * serialize this to YAML/JSON and point the analyzer's recognizer registry at it.
 *
 * Notes: JS regex flags become Python inline flags (`(?i)`); group-capture
 * recognizers redact the whole match server-side (over-redaction is safe).
 */
export interface PresidioPattern {
  name: string;
  regex: string;
  score: number;
}

export interface PresidioRecognizer {
  name: string;
  supported_language: string;
  supported_entity: string;
  patterns: PresidioPattern[];
}

function toPythonRegex(re: RegExp): string {
  const inlineFlags = re.flags.includes('i') ? '(?i)' : '';
  return `${inlineFlags}${re.source}`;
}

export function toPresidioRecognizers(
  recognizers: readonly Recognizer[] = CUSTOM_RECOGNIZERS,
  language = 'en',
): { recognizers: PresidioRecognizer[] } {
  return {
    recognizers: recognizers.map((r, i) => ({
      name: `Arbiter ${r.type} #${i + 1}`,
      supported_language: language,
      supported_entity: r.type,
      patterns: [{ name: `${r.type.toLowerCase()}_${i + 1}`, regex: toPythonRegex(r.pattern), score: r.score }],
    })),
  };
}
