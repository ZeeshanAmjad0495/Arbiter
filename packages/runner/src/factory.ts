import { type ArbiterConfig, getConfig } from '@arbiter/config';
import { OfflineTestRunner } from './offline';
import { RealTestRunner } from './real';
import type { TestRunner } from './types';

/**
 * Real vs offline is a config decision, not a caller decision. Real spawns the
 * actual Playwright/k6 binary (opt-in — it executes user code); offline is the
 * deterministic default used everywhere a binary isn't guaranteed (tests, CI,
 * a fresh checkout).
 */
export function createRunner(config: ArbiterConfig = getConfig()): TestRunner {
  return config.runner === 'real' ? new RealTestRunner(config.env.ARBITER_RUNNER_TIMEOUT_MS) : new OfflineTestRunner();
}
