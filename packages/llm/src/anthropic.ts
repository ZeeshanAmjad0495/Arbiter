import Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ArbiterConfig } from '@arbiter/config';
import { ProviderError } from '@arbiter/core';
import type { GenerateRequest, GenerateResult, LlmProvider, ModelTier } from './types';

const TOOL_NAME = 'emit_result';

/**
 * Real Anthropic provider. Structured output via FORCED tool use: we build the
 * JSON Schema from the Zod schema ourselves (zod-to-json-schema, zod-v3-safe)
 * and validate the tool input with the same Zod schema. We deliberately do NOT
 * use the SDK's `zodOutputFormat` helper — it targets zod v4 internals and
 * throws on our zod-v3 schemas. Prompt caching is applied to the system prefix.
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly kind = 'anthropic' as const;
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly models: ArbiterConfig['models'],
    baseURL?: string,
  ) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  modelFor(tier: ModelTier): string {
    return this.models[tier];
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const model = this.modelFor(req.tier ?? 'default');
    const jsonSchema = zodToJsonSchema(req.schema as unknown as z.ZodTypeAny, { $refStrategy: 'none' }) as Record<
      string,
      unknown
    >;
    delete jsonSchema.$schema;
    const inputSchema = { type: 'object', ...jsonSchema } as Anthropic.Tool['input_schema'];

    let res: Anthropic.Message;
    try {
      res = await this.client.messages.create({
        model,
        max_tokens: req.maxTokens ?? 4096,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.prompt }],
        tools: [{ name: TOOL_NAME, description: 'Emit the structured result matching the schema.', input_schema: inputSchema }],
        tool_choice: { type: 'tool', name: TOOL_NAME },
      });
    } catch (error) {
      throw new ProviderError('Anthropic generation call failed', { cause: error, context: { model } });
    }

    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new ProviderError('Anthropic did not return a tool_use block', { context: { model } });
    }
    const parsed = req.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new ProviderError('Anthropic output failed schema validation', {
        context: { model, issues: parsed.error.issues.slice(0, 5) },
      });
    }

    return {
      output: parsed.data,
      model,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
      },
    };
  }
}
