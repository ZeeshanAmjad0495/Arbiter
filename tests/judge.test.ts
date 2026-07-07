import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { StubLlmProvider, createJudgeProvider, judgeArtifact } from '@arbiter/llm';
import type { GenerateRequest, GenerateResult, LlmProvider } from '@arbiter/llm';

const models = { draft: 'd', default: 'm', judge: 'j' };

describe('LLM-as-judge (Eval Workbench)', () => {
  it('returns a deterministic passing judgement offline (stub provider)', async () => {
    const j = await judgeArtifact(new StubLlmProvider(models), {
      rubric: 'The test case has observable steps and a checkable expected result.',
      input: 'Login returns coverage_status.',
      output: { title: 'x', steps: ['a'], expectedResult: 'ok' },
    });
    expect(j.pass).toBe(true);
    expect(j.score).toBeGreaterThanOrEqual(70);
    expect(j.threshold).toBe(70);
  });

  it('relays a failing judgement from an independent judge provider', async () => {
    const failingJudge: LlmProvider = {
      kind: 'openai',
      modelFor: () => 'mock-judge',
      async generate<T>(_req: GenerateRequest<T>): Promise<GenerateResult<T>> {
        return {
          output: { score: 20, pass: false, reasons: ['Missing a checkable expected result.'] } as unknown as T,
          model: 'mock-judge',
          usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
        };
      },
    };
    const j = await judgeArtifact(failingJudge, { rubric: 'r', input: 'i', output: {}, threshold: 80 });
    expect(j.pass).toBe(false);
    expect(j.score).toBe(20);
    expect(j.model).toBe('mock-judge');
  });

  it('selects an INDEPENDENT judge provider when a gateway is configured', () => {
    const stubConfig = loadConfig({});
    expect(createJudgeProvider(stubConfig).kind).toBe('stub');

    const litellmConfig = loadConfig({ LITELLM_API_KEY: 'sk-test' });
    // Generation would route to LiteLLM; the judge is a separate OpenAI-compatible provider.
    expect(litellmConfig.llm).toBe('litellm');
    expect(createJudgeProvider(litellmConfig).kind).toBe('openai');
  });
});
