import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { OpenAICompatProvider, parseSseData, streamGenerate } from '@arbiter/llm';
import { StubLlmProvider } from '@arbiter/llm';

describe('LLM streaming', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses SSE deltas (text + reasoning), ignores keep-alives and [DONE]', () => {
    expect(parseSseData(' [DONE]')).toEqual([]);
    expect(parseSseData('not json')).toEqual([]);
    expect(parseSseData(JSON.stringify({ choices: [{ delta: { content: 'ab' } }] }))).toEqual([{ type: 'text', delta: 'ab' }]);
    expect(parseSseData(JSON.stringify({ choices: [{ delta: { reasoning_content: 'hm' } }] }))).toEqual([{ type: 'reasoning', delta: 'hm' }]);
  });

  it('accumulates a streamed JSON object and validates it, emitting deltas', async () => {
    const Schema = z.object({ title: z.string(), score: z.number() });
    const pieces = ['{"title": "', 'Hello', '", "score": ', '42}'];
    const sse =
      'data: ' + JSON.stringify({ choices: [{ delta: { reasoning_content: 'thinking…' } }] }) + '\n\n' +
      pieces.map((p) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] })).join('\n\n') +
      '\n\ndata: [DONE]\n\n';

    vi.stubGlobal('fetch', async () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }));

    const provider = new OpenAICompatProvider('sk-test', 'http://litellm.test/v1', 'gpt-4o-mini');
    const events: string[] = [];
    const res = await provider.generateStream({ system: 's', prompt: 'p', schema: Schema }, (e) => events.push(`${e.type}:${e.delta}`));

    expect(res.output).toEqual({ title: 'Hello', score: 42 });
    expect(events).toContain('reasoning:thinking…');
    expect(events.filter((e) => e.startsWith('text:')).length).toBe(pieces.length);
  });

  it('streamGenerate falls back to generate() for a non-streaming provider', async () => {
    const Schema = z.object({ ok: z.boolean() });
    const res = await streamGenerate(
      new StubLlmProvider({ draft: 'd', default: 'm', judge: 'j' }),
      { system: 's', prompt: 'p', schema: Schema, stub: () => ({ ok: true }) },
      () => {
        throw new Error('should not emit — stub does not stream');
      },
    );
    expect(res.output).toEqual({ ok: true });
  });
});
