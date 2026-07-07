import { describe, expect, it } from 'vitest';
import { CUSTOM_RECOGNIZERS, toPresidioRecognizers } from '@arbiter/sanitize';

describe('Presidio server-side recognizer config', () => {
  it('emits a Presidio recognizer per custom recognizer, covering custom entities', () => {
    const { recognizers } = toPresidioRecognizers();
    expect(recognizers).toHaveLength(CUSTOM_RECOGNIZERS.length);
    for (const r of recognizers) {
      expect(r.supported_language).toBe('en');
      expect(r.patterns).toHaveLength(1);
      expect(typeof r.patterns[0]!.regex).toBe('string');
      expect(r.patterns[0]!.score).toBeGreaterThan(0);
    }
    // Custom (non-standard-Presidio) entities are represented.
    const entities = new Set(recognizers.map((r) => r.supported_entity));
    expect(entities.has('MEMBER_ID')).toBe(true);
    expect(entities.has('GENERIC_SECRET')).toBe(true);
  });

  it('translates case-insensitive JS patterns to Python inline flags', () => {
    const ciSource = { type: 'MEMBER_ID' as const, pattern: /\bMEM\d+\b/gi, score: 0.7 };
    const out = toPresidioRecognizers([ciSource]);
    expect(out.recognizers[0]!.patterns[0]!.regex.startsWith('(?i)')).toBe(true);
  });
});
