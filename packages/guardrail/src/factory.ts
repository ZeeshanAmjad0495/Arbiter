import { type ArbiterConfig, getConfig } from '@arbiter/config';
import { createRepositories } from '@arbiter/db';
import { createLlmProvider } from '@arbiter/llm';
import { createSanitizer } from '@arbiter/sanitize';
import { createTracer } from '@arbiter/telemetry';
import { SubstringGroundingValidator } from './grounding';
import { GuardrailEngine, type GuardrailDeps } from './pipeline';
import { PolicyReviewGate } from './review';

/**
 * Wires a fully-default engine from config, or accepts overrides (used by tests
 * to inject fakes / an in-memory tracer). Real vs. offline mode for each
 * dependency is decided by config, not here.
 */
export function createGuardrailEngine(overrides: Partial<GuardrailDeps> = {}): GuardrailEngine {
  const config: ArbiterConfig = overrides.config ?? getConfig();
  const deps: GuardrailDeps = {
    config,
    tracer: overrides.tracer ?? createTracer(config.telemetry),
    sanitizer: overrides.sanitizer ?? createSanitizer(config),
    llm: overrides.llm ?? createLlmProvider(config),
    repos: overrides.repos ?? createRepositories(),
    grounding: overrides.grounding ?? new SubstringGroundingValidator(),
    review: overrides.review ?? new PolicyReviewGate(),
    ...(overrides.clock ? { clock: overrides.clock } : {}),
  };
  return new GuardrailEngine(deps);
}
