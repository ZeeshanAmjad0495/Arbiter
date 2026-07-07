import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ArbiterConfig } from '@arbiter/config';
import { ProviderError } from '@arbiter/core';
import type { GenerateRequest, GenerateResult, LlmProvider, ModelTier } from './types';

/**
 * Real provider. Uses the Anthropic Messages API with:
 *  - structured outputs via `messages.parse` + `zodOutputFormat` (grammar-level
 *    JSON — eliminates parse failures as a class), and
 *  - prompt caching on the static system prefix (`cache_control: ephemeral`).
 *
 * The request is deliberately minimal (no thinking/effort) so the same call
 * works across the Haiku / Sonnet / Opus cascade without per-model 400s.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly models: ArbiterConfig['models'],
  ) {
    this.client = new Anthropic({ apiKey });
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = this.modelFor(req.tier ?? 'default');
    let res;
    try {
      res = await this.client.messages.parse({
        model,
        max_tokens: req.maxTokens ?? 4096,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.prompt }],
        // The 0.110 `helpers/zod` typings target zod v4 internals; we pin zod v3,
        // which is also in the SDK's supported peer range (^3.25 || ^4) and works
        // at runtime. Cast only at this single external seam.
        output_config: { format: zodOutputFormat(req.schema as unknown as Parameters<typeof zodOutputFormat>[0]) },
      });
    } catch (error) {
      throw new ProviderError('Anthropic generation call failed', { cause: error, context: { model } });
    }

    const parsed = res.parsed_output as T | null;
    if (parsed == null) {
      throw new ProviderError('Structured output could not be parsed against the schema', { context: { model } });
    }
    // Re-validate through our own schema instance to be certain of the shape.
    const output = req.schema.parse(parsed);

    return {
      output,
      model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
