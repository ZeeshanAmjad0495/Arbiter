import type { ArbiterConfig } from '@arbiter/config';

/**
 * Local, free, offline embeddings for dense retrieval. Uses @huggingface/transformers
 * (Transformers.js) with all-MiniLM-L6-v2 — 384-dim, runs in-process via onnxruntime,
 * NO paid API. The dependency is dynamically imported so it never loads (or downloads
 * a model) unless dense retrieval is actually enabled.
 */
export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIM = 384;

export function embeddingsEnabled(config: ArbiterConfig): boolean {
  return config.embeddings === 'local';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let extractor: any = null;

async function getExtractor(): Promise<(text: string, opts: object) => Promise<{ data: Float32Array }>> {
  if (!extractor) {
    const { pipeline } = await import('@huggingface/transformers');
    extractor = await pipeline('feature-extraction', EMBEDDING_MODEL);
  }
  return extractor;
}

/** Embed texts to unit-normalized 384-d vectors (mean-pooled). */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extract = await getExtractor();
  const out: number[][] = [];
  for (const text of texts) {
    const res = await extract(text, { pooling: 'mean', normalize: true });
    out.push(Array.from(res.data));
  }
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  return (await embedTexts([text]))[0] ?? [];
}
