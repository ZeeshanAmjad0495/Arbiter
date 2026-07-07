import { z } from 'zod';
import type { LlmProvider } from './types';

/**
 * LLM-as-judge (Eval Workbench core). A rubric-scored, provider-pluggable second
 * opinion on an artifact. Use an INDEPENDENT provider (see createJudgeProvider)
 * so the judge is not marking the generator's own homework. Offline, the stub
 * provider returns a deterministic passing judgement so the judge runs in CI.
 */
export const Judgement = z.object({
  score: z.number().min(0).max(100),
  pass: z.boolean(),
  reasons: z.array(z.string()),
});
export type Judgement = z.infer<typeof Judgement>;

export interface JudgeInput {
  /** What "good" looks like — the criteria to score against. */
  rubric: string;
  /** The input/context the artifact was generated from. */
  input: string;
  /** The artifact under review. */
  output: unknown;
  /** Pass threshold (0–100). Default 70. */
  threshold?: number;
}

export type JudgeResult = Judgement & { model: string; threshold: number };

export async function judgeArtifact(provider: LlmProvider, opts: JudgeInput): Promise<JudgeResult> {
  const threshold = opts.threshold ?? 70;
  const res = await provider.generate<Judgement>({
    system: [
      'You are a strict, impartial QA judge. Score how well the artifact satisfies the rubric from 0 to 100.',
      'Be specific and critical; do not inflate. Set `pass` true only if the artifact genuinely meets the rubric.',
    ].join('\n'),
    prompt: [
      `Rubric:\n${opts.rubric}`,
      `\nInput / context:\n${opts.input}`,
      `\nArtifact under review:\n${JSON.stringify(opts.output, null, 2)}`,
      `\nReturn a judgement {score, pass, reasons}. \`pass\` should reflect score >= ${threshold}.`,
    ].join('\n'),
    schema: Judgement,
    tier: 'judge',
    // Offline stub: a deterministic passing judgement so the workbench runs in CI
    // without a judge API. Real providers actually evaluate the artifact.
    stub: () => ({ score: 85, pass: true, reasons: ['Offline stub judge (no judge API key) — deterministic pass for CI.'] }),
  });
  return { ...res.output, model: res.model, threshold };
}
