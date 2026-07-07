import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AnthropicLlmProvider } from '@arbiter/llm';

describe('AnthropicLlmProvider (mock server)', () => {
  it('builds a JSON-schema tool from a zod v3 schema, forces tool use, and validates the result', async () => {
    // Regression for the zodOutputFormat v3/v4 crash: the provider must NOT call
    // the SDK's zod helper; it builds the schema itself and parses tool_use.
    let captured: Record<string, unknown> | null = null;
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        captured = JSON.parse(body);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-test',
            stop_reason: 'tool_use',
            stop_sequence: null,
            content: [{ type: 'tool_use', id: 'tu_1', name: 'emit_result', input: { label: 'ok', scores: [1, 2] } }],
            usage: { input_tokens: 11, output_tokens: 3 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const provider = new AnthropicLlmProvider(
      'test-key',
      { draft: 'claude-test', default: 'claude-test', judge: 'claude-test' },
      `http://localhost:${port}`,
    );
    const schema = z.object({ label: z.string(), scores: z.array(z.number()).min(1) });
    const result = await provider.generate({ system: 'sys', prompt: 'go', schema });

    const req = captured as Record<string, unknown> | null;
    const tools = (req?.tools as Array<{ name: string; input_schema: { type: string } }>) ?? [];
    const toolChoice = req?.tool_choice as { name?: string } | undefined;

    server.close();
    expect(provider.kind).toBe('anthropic');
    expect(result.output.label).toBe('ok');
    expect(result.output.scores).toEqual([1, 2]);
    expect(result.usage.inputTokens).toBe(11);
    expect(tools[0]?.name).toBe('emit_result');
    expect(tools[0]?.input_schema.type).toBe('object');
    expect(toolChoice?.name).toBe('emit_result');
  });
});
