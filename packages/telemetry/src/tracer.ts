/**
 * A minimal, OTel-shaped tracing abstraction.
 *
 * Phase 0 records spans in-memory (and optionally to the console) so the
 * hello-world workflow can emit and render a real trace tree with zero infra.
 * The interface mirrors OpenTelemetry's Span/Tracer so a real OTLP exporter
 * (-> Langfuse) can be added behind `createTracer()` without touching callers.
 */

export type AttrValue = string | number | boolean;
export type SpanStatus = 'unset' | 'ok' | 'error';

export interface SpanEvent {
  readonly name: string;
  readonly atMs: number;
  readonly attributes?: Readonly<Record<string, AttrValue>>;
}

export interface SpanData {
  readonly name: string;
  readonly attributes: Record<string, AttrValue>;
  status: SpanStatus;
  readonly startMs: number;
  endMs?: number;
  readonly events: SpanEvent[];
  readonly children: SpanData[];
}

export interface Span {
  setAttribute(key: string, value: AttrValue): this;
  setAttributes(attrs: Readonly<Record<string, AttrValue>>): this;
  addEvent(name: string, attributes?: Readonly<Record<string, AttrValue>>): this;
  setStatus(status: SpanStatus): this;
  recordException(err: unknown): this;
  startChild(name: string, attributes?: Readonly<Record<string, AttrValue>>): Span;
  end(): void;
  readonly data: SpanData;
}

export interface Tracer {
  startSpan(name: string, attributes?: Readonly<Record<string, AttrValue>>): Span;
  /** Root spans recorded this process (in-memory tracer only). */
  readonly roots: readonly SpanData[];
}

const nowMs = (): number => Date.now();

class InMemorySpan implements Span {
  readonly data: SpanData;
  private readonly onConsole: boolean;

  constructor(name: string, attributes: Readonly<Record<string, AttrValue>>, onConsole: boolean) {
    this.data = {
      name,
      attributes: { ...attributes },
      status: 'unset',
      startMs: nowMs(),
      events: [],
      children: [],
    };
    this.onConsole = onConsole;
  }

  setAttribute(key: string, value: AttrValue): this {
    this.data.attributes[key] = value;
    return this;
  }

  setAttributes(attrs: Readonly<Record<string, AttrValue>>): this {
    Object.assign(this.data.attributes, attrs);
    return this;
  }

  addEvent(name: string, attributes?: Readonly<Record<string, AttrValue>>): this {
    this.data.events.push({ name, atMs: nowMs(), attributes });
    return this;
  }

  setStatus(status: SpanStatus): this {
    this.data.status = status;
    return this;
  }

  recordException(errValue: unknown): this {
    const message = errValue instanceof Error ? errValue.message : String(errValue);
    this.data.events.push({ name: 'exception', atMs: nowMs(), attributes: { 'exception.message': message } });
    this.data.status = 'error';
    return this;
  }

  startChild(name: string, attributes: Readonly<Record<string, AttrValue>> = {}): Span {
    const child = new InMemorySpan(name, attributes, this.onConsole);
    this.data.children.push(child.data);
    return child;
  }

  end(): void {
    this.data.endMs = nowMs();
    if (this.onConsole) {
      const ms = (this.data.endMs - this.data.startMs).toFixed(0);
      // eslint-disable-next-line no-console
      console.error(`[trace] ${this.data.name} (${ms}ms) status=${this.data.status}`);
    }
  }
}

export class InMemoryTracer implements Tracer {
  private readonly _roots: SpanData[] = [];
  constructor(private readonly onConsole = false) {}

  startSpan(name: string, attributes: Readonly<Record<string, AttrValue>> = {}): Span {
    const span = new InMemorySpan(name, attributes, this.onConsole);
    this._roots.push(span.data);
    return span;
  }

  get roots(): readonly SpanData[] {
    return this._roots;
  }
}

/**
 * Factory. `telemetry: 'otlp'` is a documented Phase 0.1 extension point — until
 * the exporter adapter lands, both modes use the in-memory tracer (console-on
 * when an OTLP endpoint is configured, so operators see span output in logs).
 */
export function createTracer(mode: 'otlp' | 'noop'): Tracer {
  return new InMemoryTracer(mode === 'otlp');
}

/** Run `fn` inside a span, recording exceptions and closing the span. */
export async function withSpan<T>(
  parent: Tracer | Span,
  name: string,
  attributes: Readonly<Record<string, AttrValue>>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const span = 'startChild' in parent ? parent.startChild(name, attributes) : parent.startSpan(name, attributes);
  try {
    const result = await fn(span);
    if (span.data.status === 'unset') span.setStatus('ok');
    return result;
  } catch (error) {
    span.recordException(error);
    throw error;
  } finally {
    span.end();
  }
}

/** Render a span tree as indented text — used by the hello CLI to prove "a trace". */
export function renderTrace(root: SpanData, indent = 0): string {
  const pad = '  '.repeat(indent);
  const dur = root.endMs === undefined ? '…' : `${(root.endMs - root.startMs).toFixed(0)}ms`;
  const attrs = Object.entries(root.attributes)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ');
  const lines = [`${pad}• ${root.name} [${root.status}] ${dur}${attrs ? '  ' + attrs : ''}`];
  for (const event of root.events) {
    lines.push(`${pad}    ↳ event:${event.name}`);
  }
  for (const child of root.children) {
    lines.push(renderTrace(child, indent + 1));
  }
  return lines.join('\n');
}
