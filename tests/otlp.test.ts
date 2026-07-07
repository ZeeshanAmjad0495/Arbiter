import { describe, expect, it } from 'vitest';
import type { SpanData } from '@arbiter/telemetry';
import { toOtlpTraces } from '@arbiter/telemetry';

// Deterministic ids so the payload is assertable.
function seqIdGen() {
  let s = 0;
  let t = 0;
  return { spanId: () => `span${++s}`, traceId: () => `trace${++t}` };
}

function span(name: string, over: Partial<SpanData> = {}): SpanData {
  return { name, attributes: {}, status: 'ok', startMs: 1000, endMs: 1002, events: [], children: [], ...over };
}

describe('OTLP trace converter', () => {
  it('flattens the span tree with trace + parent linkage', () => {
    const root = span('workflow.run', {
      attributes: { 'arbiter.workflow': 'test-case', count: 3, blocked: false },
      children: [span('sanitize'), span('generate', { status: 'error' })],
    });
    const out = toOtlpTraces([root], { serviceName: 'arbiter', idgen: seqIdGen() });

    const rs = out.resourceSpans[0] as any;
    expect(rs.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'arbiter' } });

    const spans = rs.scopeSpans[0].spans as any[];
    expect(spans).toHaveLength(3);
    // All share one traceId; children link to the root spanId.
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    const rootSpan = spans[0];
    expect(rootSpan.parentSpanId).toBeUndefined();
    expect(spans[1].parentSpanId).toBe(rootSpan.spanId);
    expect(spans[2].parentSpanId).toBe(rootSpan.spanId);
  });

  it('converts attribute types and status codes and nanos', () => {
    const out = toOtlpTraces(
      [span('s', { attributes: { name: 'x', n: 5, flag: true }, status: 'error', startMs: 1000, endMs: 1500 })],
      { serviceName: 'arbiter', idgen: seqIdGen() },
    );
    const s = (out.resourceSpans[0] as any).scopeSpans[0].spans[0];
    expect(s.attributes).toContainEqual({ key: 'name', value: { stringValue: 'x' } });
    expect(s.attributes).toContainEqual({ key: 'n', value: { intValue: '5' } });
    expect(s.attributes).toContainEqual({ key: 'flag', value: { boolValue: true } });
    expect(s.status).toEqual({ code: 2 }); // error
    expect(s.startTimeUnixNano).toBe('1000000000'); // 1000ms * 1e6
    expect(s.endTimeUnixNano).toBe('1500000000');
  });
});
