import { describe, expect, it } from 'vitest';
import { summaryOf } from '../apps/api/src/server';

/**
 * Shapes below are the REAL ones produced by the 39 workflows (taken from the Zuub
 * real-LLM run), because the two bugs this pins were caused by guessing at shape:
 * a positional "first string" pick returned an enum, and list-shaped outputs have no
 * top-level string at all.
 */
describe('review-queue summary derivation', () => {
  it('prefers an explicit title', () => {
    expect(summaryOf({ title: 'Cigna claim retrieval times out', severity: 'major' })).toBe('Cigna claim retrieval times out');
  });

  it('finds a suffixed summary field regardless of key order (test_strategy)', () => {
    // riskPosture comes FIRST in key order — the old code returned "elevated".
    const testStrategy = {
      riskPosture: 'elevated',
      inScope: ['a'],
      signOffRequired: true,
      strategySummary: 'Risk-based strategy focused on deductible reset logic across plan types.',
    };
    expect(summaryOf(testStrategy)).toBe('Risk-based strategy focused on deductible reset logic across plan types.');
  });

  it('describes list-shaped output that has no top-level string (edge_cases)', () => {
    const edgeCases = {
      edgeCases: [
        { category: 'boundaries', priority: 'high', scenario: 'Timeout threshold is 30s but the payer portal took longer.', whyItMatters: '…' },
        { category: 'partitions', priority: 'high', scenario: 'Only a subset of payers affected.' },
      ],
      lowValueBucket: ['x'],
    };
    expect(summaryOf(edgeCases)).toBe('2 edge cases — Timeout threshold is 30s but the payer portal took longer.');
  });

  it('describes requirement_analysis via its ambiguities', () => {
    const req = {
      ambiguities: [{ severity: 'high', statement: 'Deductible reset basis is unspecified for non-calendar plans.' }],
      testabilityScore: 3,
    };
    expect(summaryOf(req)).toBe('1 ambiguities — Deductible reset basis is unspecified for non-calendar plans.');
  });

  it('never falls back to a short enum value', () => {
    expect(summaryOf({ riskPosture: 'elevated', verdictCode: 'go' })).toBe('(untitled artifact)');
  });

  it('uses descriptive prose when there is no titled field or list', () => {
    const prose = 'The change deals with intermittent timeouts in claim retrieval for Cigna.';
    expect(summaryOf({ notes: prose })).toBe(prose);
  });

  it('clips very long summaries', () => {
    const long = 'x'.repeat(500);
    const out = summaryOf({ summary: long });
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('…')).toBe(true);
  });

  it('handles non-object content', () => {
    expect(summaryOf(null)).toBe('(untitled artifact)');
    expect(summaryOf(['a'])).toBe('(untitled artifact)');
  });
});
