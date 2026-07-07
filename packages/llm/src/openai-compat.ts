import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ProviderError } from '@arbiter/core';
import { extractJson } from './kimi';
import type { GenerateRequest, GenerateResult, LlmProvider, ModelTier, StreamEvent } from './types';

/**
 * Parse one OpenAI-style SSE `data:` payload into stream events. Exported for
 * unit testing. `[DONE]` and non-JSON keep-alives yield nothing.
 */
export function parseSseData(payload: string): StreamEvent[] {
  const trimmed = payload.trim();
  if (trimmed === '' || trimmed === '[DONE]') return [];
  let json: { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> };
  try {
    json = JSON.parse(trimmed);
  } catch {
    return [];
  }
  const delta = json.choices?.[0]?.delta ?? {};
  const events: StreamEvent[] = [];
  if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
    events.push({ type: 'reasoning', delta: delta.reasoning_content });
  }
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    events.push({ type: 'text', delta: delta.content });
  }
  return events;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Generic OpenAI-compatible chat-completions provider. Works against a LiteLLM
 * gateway (multi-provider routing) or any OpenAI-compatible endpoint, and is the
 * second provider used for judge independence (Eval Workbench). Same JSON +
 * Zod-validate + one-retry contract as the Kimi provider, without the Kimi-only
 * `thinking`/temperature constraints.
 */
export class OpenAICompatProvider implements LlmProvider {
  readonly kind = 'openai' as const;

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly model: string,
  ) {}

  modelFor(_tier: ModelTier): string {
    return this.model;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = zodToJsonSchema(req.schema as unknown as z.ZodTypeAny);
    const system = [
      req.system,
      '',
      'Respond with a SINGLE JSON object that strictly conforms to this JSON Schema.',
      'Do not wrap it in markdown fences and do not add prose outside the JSON.',
      'JSON Schema:',
      JSON.stringify(jsonSchema),
    ].join('\n');

    const base: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: req.prompt },
    ];

    let lastError = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages =
        attempt === 0
          ? base
          : [...base, { role: 'user' as const, content: `Your previous reply did not satisfy the schema (${lastError}). Reply with ONLY the corrected JSON object.` }];

      const data = await this.call(messages, req.maxTokens ?? 8192);
      const parsed = extractJson(data.choices?.[0]?.message?.content ?? '');
      if (parsed === undefined) {
        lastError = 'no JSON object found in the response';
        continue;
      }
      const result = req.schema.safeParse(parsed);
      if (result.success) {
        return {
          output: result.data,
          model: this.model,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            cacheReadTokens: 0,
          },
        };
      }
      lastError = result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    }

    throw new ProviderError('OpenAI-compatible output failed schema validation after retry', {
      context: { model: this.model, lastError },
    });
  }

  async generateStream<T>(req: GenerateRequest<T>, onEvent: (e: StreamEvent) => void): Promise<GenerateResult<T>> {
    const jsonSchema = zodToJsonSchema(req.schema as unknown as z.ZodTypeAny);
    const system = [
      req.system,
      '',
      'Respond with a SINGLE JSON object that strictly conforms to this JSON Schema.',
      'Do not wrap it in markdown fences and do not add prose outside the JSON.',
      'JSON Schema:',
      JSON.stringify(jsonSchema),
    ].join('\n');
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: req.prompt },
    ];

    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, max_tokens: req.maxTokens ?? 8192, response_format: { type: 'json_object' }, stream: true }),
      });
    } catch (error) {
      throw new ProviderError('OpenAI-compatible stream request failed (network)', { cause: error, isTransient: true });
    }
    if (!res.ok || !res.body) {
      throw new ProviderError(`OpenAI-compatible API error ${res.status}`, { context: { body: (await res.text().catch(() => '')).slice(0, 300) } });
    }

    // Consume the SSE stream: split on newlines, emit deltas, accumulate content.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const handleLine = (line: string) => {
      if (!line.startsWith('data:')) return;
      for (const ev of parseSseData(line.slice(5))) {
        if (ev.type === 'text') content += ev.delta;
        onEvent(ev);
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handleLine(buffer.slice(0, nl).trim());
        buffer = buffer.slice(nl + 1);
      }
    }
    if (buffer.trim().length > 0) handleLine(buffer.trim());

    const parsed = extractJson(content);
    const result = parsed === undefined ? { success: false as const } : req.schema.safeParse(parsed);
    if (!result.success) {
      throw new ProviderError('OpenAI-compatible streamed output failed schema validation', { context: { model: this.model } });
    }
    return { output: result.data, model: this.model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } };
  }

  private async call(messages: ChatMessage[], maxTokens: number): Promise<ChatResponse> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.model, messages, max_tokens: maxTokens, response_format: { type: 'json_object' }, stream: false }),
      });
    } catch (error) {
      throw new ProviderError('OpenAI-compatible request failed (network)', { cause: error, isTransient: true });
    }
    if (!res.ok) {
      throw new ProviderError(`OpenAI-compatible API error ${res.status}`, { context: { body: (await res.text().catch(() => '')).slice(0, 300) } });
    }
    return (await res.json()) as ChatResponse;
  }
}
