import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ArbiterConfig } from '@arbiter/config';
import { ProviderError } from '@arbiter/core';
import type { GenerateRequest, GenerateResult, LlmProvider, ModelTier, StreamEvent } from './types';

interface KimiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface KimiResponse {
  choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cached_tokens?: number };
  error?: { message?: string };
}

/**
 * Kimi (Moonshot AI) provider — OpenAI-compatible chat completions with the
 * top-level `thinking` field (native reasoning). Since Kimi has no grammar-level
 * structured-output guarantee, we describe the Zod schema as JSON Schema in the
 * system prompt, request JSON output, then validate with Zod and retry once.
 */
export class KimiLlmProvider implements LlmProvider {
  readonly kind = 'kimi' as const;

  constructor(
    private readonly apiKey: string,
    private readonly cfg: ArbiterConfig['kimi'],
  ) {}

  modelFor(_tier: ModelTier): string {
    return this.cfg.model;
  }

  async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const jsonSchema = zodToJsonSchema(req.schema as unknown as z.ZodTypeAny);
    const system = [
      req.system,
      '',
      'Respond with a SINGLE JSON object that strictly conforms to this JSON Schema.',
      'Do not wrap it in markdown fences and do not add any prose outside the JSON.',
      'JSON Schema:',
      JSON.stringify(jsonSchema),
    ].join('\n');

    const base: KimiMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: req.prompt },
    ];

    let lastError = 'unknown';
    for (let attempt = 0; attempt < 2; attempt++) {
      const messages =
        attempt === 0
          ? base
          : [
              ...base,
              {
                role: 'user' as const,
                content: `Your previous reply did not satisfy the schema (${lastError}). Reply with ONLY the corrected JSON object.`,
              },
            ];

      const data = await this.call(messages, req.maxTokens ?? 8192);
      const content = data.choices?.[0]?.message?.content ?? '';
      const parsed = extractJson(content);
      if (parsed === undefined) {
        lastError = 'no JSON object found in the response';
        continue;
      }
      const result = req.schema.safeParse(parsed);
      if (result.success) {
        return {
          output: result.data,
          model: this.cfg.model,
          usage: {
            inputTokens: data.usage?.prompt_tokens ?? 0,
            outputTokens: data.usage?.completion_tokens ?? 0,
            cacheReadTokens: data.usage?.cached_tokens ?? 0,
          },
        };
      }
      lastError = result.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
    }

    throw new ProviderError('Kimi output failed schema validation after retry', {
      context: { model: this.cfg.model, lastError },
    });
  }

  /** Token streaming — emits Kimi's `reasoning_content` (the slow thinking) + content deltas. */
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
    const messages: KimiMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: req.prompt },
    ];

    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ model: this.cfg.model, messages, thinking: { type: this.cfg.thinking }, temperature: 1, max_tokens: req.maxTokens ?? 8192, stream: true }),
      });
    } catch (error) {
      throw new ProviderError('Kimi stream request failed (network)', { cause: error, isTransient: true });
    }
    if (!res.ok || !res.body) {
      throw new ProviderError(`Kimi API error ${res.status}`, { context: { body: (await res.text().catch(() => '')).slice(0, 300) } });
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const handle = (line: string): void => {
      if (!line.startsWith('data:')) return;
      const payload = line.slice(5).trim();
      if (payload === '' || payload === '[DONE]') return;
      let json: { choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }> };
      try {
        json = JSON.parse(payload);
      } catch {
        return;
      }
      const delta = json.choices?.[0]?.delta ?? {};
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) onEvent({ type: 'reasoning', delta: delta.reasoning_content });
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onEvent({ type: 'text', delta: delta.content });
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl).trim());
        buffer = buffer.slice(nl + 1);
      }
    }
    if (buffer.trim().length > 0) handle(buffer.trim());

    const parsed = extractJson(content);
    const result = parsed === undefined ? ({ success: false } as const) : req.schema.safeParse(parsed);
    if (!result.success) {
      throw new ProviderError('Kimi streamed output failed schema validation', { context: { model: this.cfg.model } });
    }
    return { output: result.data, model: this.cfg.model, usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 } };
  }

  private async call(messages: KimiMessage[], maxTokens: number): Promise<KimiResponse> {
    const url = `${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      thinking: { type: this.cfg.thinking },
      // Kimi K2.6 (thinking) only permits temperature=1.
      temperature: 1,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
      stream: false,
    };

    const post = (payload: Record<string, unknown>) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(payload),
      });

    let res: Response;
    try {
      res = await post(body);
    } catch (error) {
      throw new ProviderError('Kimi request failed (network)', { cause: error, isTransient: true });
    }

    if (!res.ok) {
      // Distinguish a genuine empty body from a failed body read (the latter was
      // previously swallowed to '' with no signal) so error triage isn't misled.
      const text = await res.text().catch((err) => {
        console.error(`kimi_error_body_read_failed status=${res.status}: ${err instanceof Error ? err.message : String(err)}`);
        return '<body read failed>';
      });
      // Some deployments reject response_format alongside thinking — retry without it.
      if (res.status === 400 && text.includes('response_format')) {
        const retry: Record<string, unknown> = { ...body };
        delete retry.response_format;
        const res2 = await post(retry);
        if (!res2.ok) {
          throw new ProviderError(`Kimi API error ${res2.status}`, {
            context: { body: (await res2.text().catch(() => '')).slice(0, 300) },
          });
        }
        return (await res2.json()) as KimiResponse;
      }
      throw new ProviderError(`Kimi API error ${res.status}`, { context: { body: text.slice(0, 300) } });
    }
    return (await res.json()) as KimiResponse;
  }
}

/** Robustly pull a JSON object out of a model reply (handles stray fences/prose). */
export function extractJson(content: string): unknown {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to brace extraction */
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return undefined;
    }
  }
  return undefined;
}
