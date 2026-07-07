import type { z } from 'zod';

/**
 * Deterministic sample generator from a Zod schema. Used only as the fallback
 * for the stub LLM provider when a workflow does not supply an explicit stub().
 * It is intentionally small — covers the schema shapes Arbiter's workflows use
 * — and always returns a value that satisfies the schema (validated by caller).
 */
export function zodMock<T>(schema: z.ZodType<T>): T {
  return build(schema as unknown as ZodAny) as T;
}

// Minimal structural view over Zod internals (v3 `_def`).
interface ZodAny {
  _def: {
    typeName: string;
    checks?: Array<{ kind: string; value?: unknown }>;
    type?: ZodAny; // array element / branded inner
    innerType?: ZodAny; // optional / nullable / default inner
    schema?: ZodAny; // effects
    values?: string[]; // enum
    value?: unknown; // literal
    shape?: () => Record<string, ZodAny>; // object
    options?: ZodAny[]; // union
    valueType?: ZodAny; // record
    defaultValue?: () => unknown; // default
    minLength?: { value: number } | null; // array
    exactLength?: { value: number } | null; // array
  };
}

const FIXED_UUID = '00000000-0000-4000-8000-000000000000';
const FIXED_DATETIME = '2026-01-01T00:00:00.000Z';

function build(schema: ZodAny): unknown {
  const def = schema._def;
  switch (def.typeName) {
    case 'ZodString':
      return stringFor(def.checks ?? []);
    case 'ZodNumber':
      return 0;
    case 'ZodBoolean':
      return false;
    case 'ZodDate':
      return new Date(0);
    case 'ZodLiteral':
      return def.value;
    case 'ZodEnum':
      return def.values?.[0] ?? '';
    case 'ZodArray': {
      // Honor .min(n) / .length(n) so required non-empty arrays validate.
      const count = def.exactLength?.value ?? def.minLength?.value ?? 0;
      return def.type && count > 0 ? Array.from({ length: count }, () => build(def.type as ZodAny)) : [];
    }
    case 'ZodObject': {
      const shape = def.shape?.() ?? {};
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(shape)) {
        out[key] = build(child);
      }
      return out;
    }
    case 'ZodOptional':
      // zod v3 stores the inner schema under innerType for optional/nullable.
      return def.innerType ? build(def.innerType) : undefined;
    case 'ZodNullable':
      return def.innerType ? build(def.innerType) : null;
    case 'ZodBranded':
      return def.type ? build(def.type) : undefined;
    case 'ZodDefault':
      return def.defaultValue ? def.defaultValue() : def.innerType ? build(def.innerType) : undefined;
    case 'ZodEffects':
      return def.schema ? build(def.schema) : undefined;
    case 'ZodUnion':
      return def.options?.[0] ? build(def.options[0]) : undefined;
    case 'ZodRecord':
      return {};
    case 'ZodUnknown':
    case 'ZodAny':
    default:
      return null;
  }
}

function stringFor(checks: Array<{ kind: string; value?: unknown }>): string {
  for (const c of checks) {
    if (c.kind === 'uuid') return FIXED_UUID;
    if (c.kind === 'datetime') return FIXED_DATETIME;
    if (c.kind === 'email') return 'user@example.com';
    if (c.kind === 'url') return 'https://example.com';
  }
  return 'sample';
}
