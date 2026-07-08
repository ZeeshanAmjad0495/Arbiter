import { defineConfig, devices } from '@playwright/test';

// Dedicated ports so the E2E stack never collides with the dev servers (web 5173 /
// API 4310). Both are booted offline (stub LLM, in-memory, no auth) by webServer below.
const API_PORT = 4311;
const WEB_PORT = 4322;

export default defineConfig({
  testDir: './apps/web/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm e2e:api',
      env: { ARBITER_API_PORT: String(API_PORT) },
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @arbiter/web exec vite dev --port ${WEB_PORT} --strictPort`,
      env: { ARBITER_API_ORIGIN: `http://localhost:${API_PORT}` },
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
