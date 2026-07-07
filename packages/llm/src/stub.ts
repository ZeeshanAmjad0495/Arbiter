import type { ArbiterConfig } from '@arbiter/config';
import type { GenerateRequest, GenerateResult, LlmProvider, ModelTier } from './types';
import { zodMock } from './zod-mock';

/**
 * Deterministic, offline provider. Selected automatically when ANTHROPIC_API_KEY
 * is unset so `pnpm hello`, unit tests, and CI exercise the whole pipeline
 * (validate + gate + audit) without a network call.
 */
export class StubLlmProvider implements LlmProvider {
  readonly kind = 'stub' as const;
  constructor(private readonly models: ArbiterConfig['models']) {}

  modelFor(tier: ModelTier): string {
    return `stub:${this.models[tier]}`;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const raw = req.stub ? req.stub() : zodMock(req.schema);
    // Validate so the stub can never emit something the real provider couldn't.
    const output = req.schema.parse(raw);
    return {
      output,
      model: this.modelFor(req.tier ?? 'default'),
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    };
  }
}
