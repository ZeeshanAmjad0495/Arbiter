import { z } from 'zod';
import { ConfigError } from '@arbiter/core';

/** An optional URL that treats a blank .env value ("") as unset instead of failing validation. */
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional());

/**
 * Central runtime config. Every external dependency degrades to an offline mode
 * when its env vars are absent, so the whole platform runs with zero infra for
 * local dev / CI while using the real services in deployed environments.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ARBITER_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  DATABASE_URL: optionalUrl,

  PRESIDIO_ANALYZER_URL: optionalUrl,
  PRESIDIO_ANONYMIZER_URL: optionalUrl,

  ARBITER_DEMASK_KEY: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ARBITER_MODEL_DRAFT: z.string().default('claude-haiku-4-5-20251001'),
  ARBITER_MODEL_DEFAULT: z.string().default('claude-sonnet-5'),
  ARBITER_MODEL_JUDGE: z.string().default('claude-opus-4-8'),

  // Kimi (Moonshot AI) — OpenAI-compatible. When KIMI_API_KEY is set it takes
  // precedence over Anthropic. Defaults to the latest thinking model.
  KIMI_API_KEY: z.string().optional(),
  KIMI_BASE_URL: z.string().url().default('https://api.moonshot.ai/v1'),
  KIMI_MODEL: z.string().default('kimi-k2.6'),
  KIMI_THINKING: z.enum(['enabled', 'disabled']).default('enabled'),

  // LiteLLM gateway (OpenAI-compatible) — a second provider for judge independence
  // and multi-provider routing. Lower precedence than Kimi/Anthropic.
  LITELLM_BASE_URL: z.string().url().default('http://localhost:4000/v1'),
  LITELLM_API_KEY: z.string().optional(),
  LITELLM_MODEL: z.string().default('gpt-4o-mini'),

  // Optional independent judge provider (Eval Workbench) — kept distinct from the
  // generation provider so the LLM-as-judge is not marking its own homework.
  ARBITER_JUDGE_BASE_URL: optionalUrl,
  ARBITER_JUDGE_API_KEY: z.string().optional(),
  ARBITER_JUDGE_MODEL: z.string().default('gpt-4o-mini'),

  // Jira read-only fetch-by-ticket-key (Phase 1 grounding pull-forward).
  JIRA_BASE_URL: optionalUrl,
  JIRA_EMAIL: z.string().optional(),
  JIRA_API_TOKEN: z.string().optional(),

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  OTEL_SERVICE_NAME: z.string().default('arbiter'),

  ARBITER_API_PORT: z.coerce.number().int().positive().default(4310),
  // Bind to localhost by default; opt into wider exposure explicitly.
  ARBITER_API_HOST: z.string().default('127.0.0.1'),
  // Optional admin master token — can issue access keys and bypasses session auth.
  ARBITER_API_TOKEN: z.string().optional(),

  // Key-based auth. A bootstrap admin is provisioned at boot; in non-production a
  // fresh admin access key is logged so there's always a way in.
  ARBITER_ADMIN_EMAIL: z.string().email().default('admin@arbiter.local'),
  ARBITER_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
});

export type Env = z.infer<typeof EnvSchema>;

export interface ArbiterConfig {
  readonly env: Env;
  readonly persistence: 'postgres' | 'memory';
  readonly sanitizer: 'presidio' | 'regex';
  readonly llm: 'anthropic' | 'kimi' | 'litellm' | 'stub';
  readonly telemetry: 'otlp' | 'noop';
  readonly demask: 'encrypted' | 'ephemeral';
  readonly models: {
    readonly draft: string;
    readonly default: string;
    readonly judge: string;
  };
  readonly kimi: {
    readonly baseUrl: string;
    readonly model: string;
    readonly thinking: 'enabled' | 'disabled';
  };
  readonly litellm: {
    readonly baseUrl: string;
    readonly model: string;
  };
  readonly jira: {
    readonly configured: boolean;
  };
}

let cached: ArbiterConfig | null = null;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): ArbiterConfig {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError('Invalid environment configuration', {
      context: { issues: parsed.error.issues },
    });
  }
  const env = parsed.data;
  // Precedence: Kimi > Anthropic > LiteLLM > offline stub.
  const llm: ArbiterConfig['llm'] = env.KIMI_API_KEY
    ? 'kimi'
    : env.ANTHROPIC_API_KEY
      ? 'anthropic'
      : env.LITELLM_API_KEY
        ? 'litellm'
        : 'stub';
  const models =
    llm === 'kimi'
      ? { draft: env.KIMI_MODEL, default: env.KIMI_MODEL, judge: env.KIMI_MODEL }
      : llm === 'litellm'
        ? { draft: env.LITELLM_MODEL, default: env.LITELLM_MODEL, judge: env.LITELLM_MODEL }
        : { draft: env.ARBITER_MODEL_DRAFT, default: env.ARBITER_MODEL_DEFAULT, judge: env.ARBITER_MODEL_JUDGE };
  const demask = env.ARBITER_DEMASK_KEY ? 'encrypted' : 'ephemeral';
  // Never silently store PII unencrypted in a deployed environment.
  if (env.NODE_ENV === 'production' && demask === 'ephemeral') {
    throw new ConfigError('ARBITER_DEMASK_KEY is required in production — refusing to store the de-mask PII map unencrypted');
  }
  return {
    env,
    persistence: env.DATABASE_URL ? 'postgres' : 'memory',
    sanitizer: env.PRESIDIO_ANALYZER_URL && env.PRESIDIO_ANONYMIZER_URL ? 'presidio' : 'regex',
    llm,
    telemetry: env.OTEL_EXPORTER_OTLP_ENDPOINT ? 'otlp' : 'noop',
    demask,
    models,
    kimi: {
      baseUrl: env.KIMI_BASE_URL,
      model: env.KIMI_MODEL,
      thinking: env.KIMI_THINKING,
    },
    litellm: {
      baseUrl: env.LITELLM_BASE_URL,
      model: env.LITELLM_MODEL,
    },
    jira: {
      configured: Boolean(env.JIRA_BASE_URL && env.JIRA_EMAIL && env.JIRA_API_TOKEN),
    },
  };
}

/** Process-wide memoized config. */
export function getConfig(): ArbiterConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test helper — reset the memoized config. */
export function resetConfigCache(): void {
  cached = null;
}
