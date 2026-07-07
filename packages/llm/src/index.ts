import type { ArbiterConfig } from '@arbiter/config';
import { AnthropicLlmProvider } from './anthropic';
import { KimiLlmProvider } from './kimi';
import { StubLlmProvider } from './stub';
import type { LlmProvider } from './types';

export * from './types';
export { StubLlmProvider } from './stub';
export { AnthropicLlmProvider } from './anthropic';
export { KimiLlmProvider } from './kimi';
export { zodMock } from './zod-mock';

export function createLlmProvider(config: ArbiterConfig): LlmProvider {
  if (config.llm === 'kimi' && config.env.KIMI_API_KEY) {
    return new KimiLlmProvider(config.env.KIMI_API_KEY, config.kimi);
  }
  if (config.llm === 'anthropic' && config.env.ANTHROPIC_API_KEY) {
    return new AnthropicLlmProvider(config.env.ANTHROPIC_API_KEY, config.models);
  }
  return new StubLlmProvider(config.models);
}
