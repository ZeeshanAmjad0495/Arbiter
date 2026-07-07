import { randomBytes } from 'node:crypto';
import type { AttrValue, SpanData } from './tracer';

/**
 * OTLP/HTTP (JSON) exporter — the real backend behind the OTel-shaped tracer.
 *
 * `toOtlpTraces` is a pure converter (span tree → OTLP ResourceSpans JSON) so it
 * is fully unit-testable with a deterministic id generator; `OtlpHttpExporter`
 * POSTs that payload to an OTLP endpoint (e.g. an OTel Collector → Langfuse).
 * Export never throws into the request path — telemetry failures are swallowed.
 */

export interface IdGen {
  traceId(): string; // 16 bytes hex
  spanId(): string; // 8 bytes hex
}

const randomIdGen: IdGen = {
  traceId: () => randomBytes(16).toString('hex'),
  spanId: () => randomBytes(8).toString('hex'),
};

const toNano = (ms: number): string => Math.round(ms * 1e6).toString();

function attrValue(v: AttrValue): Record<string, unknown> {
  if (typeof v === 'boolean') return { boolValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v };
  return { stringValue: v };
}

const toKeyValues = (attrs: Record<string, AttrValue>): unknown[] =>
  Object.entries(attrs).map(([key, value]) => ({ key, value: attrValue(value) }));

const STATUS_CODE: Record<SpanData['status'], number> = { unset: 0, ok: 1, error: 2 };

/** Flatten a span tree into OTLP spans, threading trace/parent ids. */
function collectSpans(node: SpanData, traceId: string, parentSpanId: string | undefined, idgen: IdGen, out: unknown[]): void {
  const spanId = idgen.spanId();
  out.push({
    traceId,
    spanId,
    ...(parentSpanId ? { parentSpanId } : {}),
    name: node.name,
    kind: 1, // SPAN_KIND_INTERNAL
    startTimeUnixNano: toNano(node.startMs),
    endTimeUnixNano: toNano(node.endMs ?? node.startMs),
    attributes: toKeyValues(node.attributes),
    events: node.events.map((e) => ({
      name: e.name,
      timeUnixNano: toNano(e.atMs),
      attributes: e.attributes ? toKeyValues(e.attributes) : [],
    })),
    status: { code: STATUS_CODE[node.status] },
  });
  for (const child of node.children) collectSpans(child, traceId, spanId, idgen, out);
}

export function toOtlpTraces(
  roots: readonly SpanData[],
  opts: { serviceName: string; idgen?: IdGen },
): { resourceSpans: unknown[] } {
  const idgen = opts.idgen ?? randomIdGen;
  const spans: unknown[] = [];
  for (const root of roots) collectSpans(root, idgen.traceId(), undefined, idgen, spans);
  return {
    resourceSpans: [
      {
        resource: { attributes: toKeyValues({ 'service.name': opts.serviceName }) },
        scopeSpans: [{ scope: { name: 'arbiter' }, spans }],
      },
    ],
  };
}

export class OtlpHttpExporter {
  constructor(
    private readonly endpoint: string,
    private readonly serviceName: string,
  ) {}

  /** POST completed root spans as OTLP traces. Best-effort: never throws. */
  async export(roots: readonly SpanData[]): Promise<boolean> {
    if (roots.length === 0) return true;
    const url = `${this.endpoint.replace(/\/$/, '')}/v1/traces`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toOtlpTraces(roots, { serviceName: this.serviceName })),
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false; // telemetry must never break the request path
    } finally {
      clearTimeout(timer);
    }
  }
}
