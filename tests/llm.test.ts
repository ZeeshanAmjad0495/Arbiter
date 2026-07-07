import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '@arbiter/config';
import { StubLlmProvider, createLlmProvider, zodMock } from '@arbiter/llm';

describe('provider selection', () => {
  it('selects Kimi K2.6 (thinking) when KIMI_API_KEY is set', () => {
    const cfg = loadConfig({ KIMI_API_KEY: 'test-key' });
    expect(cfg.llm).toBe('kimi');
    expect(cfg.models.default).toBe('kimi-k2.6');
    expect(cfg.kimi.thinking).toBe('enabled');
    const provider = createLlmProvider(cfg);
    expect(provider.kind).toBe('kimi');
    expect(provider.modelFor('default')).toBe('kimi-k2.6');
  });

  it('Kimi takes precedence over Anthropic when both keys are set', () => {
    expect(loadConfig({ KIMI_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }).llm).toBe('kimi');
  });

  it('falls back to the stub provider with no keys', () => {
    const cfg = loadConfig({});
    expect(cfg.llm).toBe('stub');
    expect(createLlmProvider(cfg).kind).toBe('stub');
  });
});

describe('zodMock', () => {
  it('produces schema-valid values for nullable and min-length-array fields', () => {
    // Regression: nullable must recurse into innerType (not undefined), and
    // required non-empty arrays must be populated to their minimum.
    const schema = z.object({
      note: z.string().nullable(),
      tags: z.array(z.string()).min(2),
      count: z.number(),
      flag: z.boolean().optional(),
    });
    const mock = zodMock(schema);
    const parsed = schema.safeParse(mock);
    expect(parsed.success).toBe(true);
    expect(Array.isArray((mock as { tags: string[] }).tags)).toBe(true);
    expect((mock as { tags: string[] }).tags.length).toBeGreaterThanOrEqual(2);
  });

  it('stub provider returns schema-valid output with no explicit stub()', async () => {
    const provider = new StubLlmProvider(loadConfig({}).models);
    const schema = z.object({ label: z.string(), scores: z.array(z.number()).min(1) });
    const result = await provider.generate({ system: 's', prompt: 'p', schema });
    expect(schema.safeParse(result.output).success).toBe(true);
    expect(result.model.startsWith('stub:')).toBe(true);
  });
});
