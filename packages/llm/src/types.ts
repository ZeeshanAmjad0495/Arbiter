import type { z } from 'zod';

/** The model cascade tiers from the plan (§5): draft -> default -> judge. */
export type ModelTier = 'draft' | 'default' | 'judge';

export interface GenerateRequest<T> {
  /** Static, cacheable system prefix (role + house rules + schema doc). */
  readonly system: string;
  /** The sanitized, grounded user content. */
  readonly prompt: string;
  /** Output contract — validated after generation. */
  readonly schema: z.ZodType<T>;
  readonly tier?: ModelTier;
  readonly maxTokens?: number;
  /**
   * Deterministic offline output used by the stub provider (no API key). Lets a
   * workflow run end-to-end without a network call while still exercising the
   * validate/gate stages against a realistic object.
   */
  readonly stub?: () => T;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
}

export interface GenerateResult<T> {
  readonly output: T;
  readonly model: string;
  readonly usage: TokenUsage;
}

/** A streamed increment while the (slow, thinking-enabled) model generates. */
export interface StreamEvent {
  readonly type: 'text' | 'reasoning';
  readonly delta: string;
}

export interface LlmProvider {
  readonly kind: 'anthropic' | 'kimi' | 'openai' | 'stub';
  modelFor(tier: ModelTier): string;
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>;
  /**
   * Optional token streaming. Emits text/reasoning deltas as they arrive (progress
   * while thinking is on) and resolves to the same validated result as generate().
   * Providers that don't implement it fall back to generate() via streamGenerate().
   */
  generateStream?<T>(req: GenerateRequest<T>, onEvent: (e: StreamEvent) => void): Promise<GenerateResult<T>>;
}

/** Use streaming when the provider supports it, else fall back to a single generate. */
export async function streamGenerate<T>(
  provider: LlmProvider,
  req: GenerateRequest<T>,
  onEvent: (e: StreamEvent) => void,
): Promise<GenerateResult<T>> {
  if (provider.generateStream) return provider.generateStream(req, onEvent);
  return provider.generate(req);
}
