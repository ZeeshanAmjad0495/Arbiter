import type { ArbiterConfig } from '@arbiter/config';
import { AnthropicLlmProvider } from './anthropic';
import { KimiLlmProvider } from './kimi';
import { OpenAICompatProvider } from './openai-compat';
import { StubLlmProvider } from './stub';
import type { LlmProvider } from './types';

export * from './types';
export { StubLlmProvider } from './stub';
export { AnthropicLlmProvider } from './anthropic';
export { KimiLlmProvider } from './kimi';
export { OpenAICompatProvider, parseSseData } from './openai-compat';
export { zodMock } from './zod-mock';
export * from './judge';

export function createLlmProvider(config: ArbiterConfig): LlmProvider {
  // DeepSeek is plain OpenAI-compatible (no Moonshot `thinking` field — reasoning is
  // selected via the model name), so it reuses the generic compat provider.
  if (config.llm === 'deepseek' && config.env.DEEP_SEEK_API_KEY) {
    return new OpenAICompatProvider(config.env.DEEP_SEEK_API_KEY, config.deepseek.baseUrl, config.deepseek.model);
  }
  if (config.llm === 'kimi' && config.env.KIMI_API_KEY) {
    return new KimiLlmProvider(config.env.KIMI_API_KEY, config.kimi);
  }
  if (config.llm === 'anthropic' && config.env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider(config.env.ANTHROPIC_API_KEY, config.models);
  }
  if (config.llm === 'litellm' && config.env.LITELLM_API_KEY) {
    return new OpenAICompatProvider(config.env.LITELLM_API_KEY, config.litellm.baseUrl, config.litellm.model);
  }
  return new StubLlmProvider(config.models);
}

/**
 * The provider for the LLM-as-judge (Eval Workbench). Prefers a provider that is
 * INDEPENDENT of generation — a dedicated judge endpoint, else the LiteLLM
 * gateway, else Anthropic (judge tier = a stronger model), else the offline stub.
 */
export function createJudgeProvider(config: ArbiterConfig): LlmProvider {
  const e = config.env;
  if (e.ARBITER_JUDGE_API_KEY && e.ARBITER_JUDGE_BASE_URL) {
    return new OpenAICompatProvider(e.ARBITER_JUDGE_API_KEY, e.ARBITER_JUDGE_BASE_URL, e.ARBITER_JUDGE_MODEL);
  }
  if (e.LITELLM_API_KEY) {
    return new OpenAICompatProvider(e.LITELLM_API_KEY, config.litellm.baseUrl, config.litellm.model);
  }
  if (e.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider(e.ANTHROPIC_API_KEY, config.models);
  }
  return new StubLlmProvider(config.models);
}
