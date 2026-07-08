import { describe, expect, it } from 'vitest';
import { OfflineTestRunner, parseK6Summary, parsePlaywrightJson } from '@arbiter/runner';

describe('offline test runner (deterministic)', () => {
  const runner = new OfflineTestRunner();

  it('parses Playwright test declarations; fail-hint titles fail, .skip is skipped', async () => {
    const script = `
      import { test, expect } from '@playwright/test';
      test('adds an item to the cart', async ({ page }) => { await page.goto('/'); });
      test.skip('flaky upload', async () => {});
      test('failing checkout total', async () => { expect(1).toBe(2); });
    `;
    const r = await runner.run({ kind: 'playwright', script });
    expect(r.mode).toBe('offline');
    expect(r.summary).toMatchObject({ total: 3, passed: 1, failed: 1, skipped: 1 });
    expect(r.status).toBe('failed');
  });

  it('parses k6 check descriptions into cases', async () => {
    const script = `
      import http from 'k6/http';
      import { check } from 'k6';
      export default function () {
        const res = http.get('https://example.com');
        check(res, {
          'status is 200': (r) => r.status === 200,
          'failing latency budget': (r) => r.timings.duration < 1,
        });
      }
    `;
    const r = await runner.run({ kind: 'k6', script });
    expect(r.summary.total).toBe(2);
    expect(r.summary.passed).toBe(1);
    expect(r.summary.failed).toBe(1);
  });

  it('is reproducible — same script yields the same durations', async () => {
    const script = "test('stable case', async () => {});";
    const a = await runner.run({ kind: 'playwright', script });
    const b = await runner.run({ kind: 'playwright', script });
    expect(a).toEqual(b);
  });

  it('no test declarations → error status (the tool produced nothing)', async () => {
    const r = await runner.run({ kind: 'playwright', script: 'const x = 1;' });
    expect(r.status).toBe('error');
    expect(r.summary.total).toBe(0);
  });
});

describe('real-runner reporter parsers', () => {
  it('flattens Playwright JSON (nested suites, per-spec verdict + error message)', () => {
    const json = JSON.stringify({
      suites: [
        {
          title: 'login',
          specs: [
            { title: 'logs in', ok: true, tests: [{ results: [{ status: 'passed', duration: 120 }] }] },
            { title: 'rejects bad password', ok: false, tests: [{ results: [{ status: 'failed', duration: 80, error: { message: 'Expected 401\n  at foo' } }] }] },
          ],
          suites: [],
        },
      ],
    });
    const cases = parsePlaywrightJson(json);
    expect(cases).toHaveLength(2);
    expect(cases[0]).toMatchObject({ status: 'passed', durationMs: 120 });
    expect(cases[1]!.status).toBe('failed');
    expect(cases[1]!.message).toContain('Expected 401'); // collapsed, bounded
  });

  it('strips ANSI colour codes from Playwright failure messages', () => {
    const esc = String.fromCharCode(27);
    const result = { status: 'failed', duration: 5, error: { message: `${esc}[31mExpected 2${esc}[39m got 1` } };
    const spec = { title: 'boom', ok: false, tests: [{ results: [result] }] };
    const report = { suites: [{ specs: [spec] }] };
    const cases = parsePlaywrightJson(JSON.stringify(report));
    expect(cases[0]!.message).toBe('Expected 2 got 1');
    expect(cases[0]!.message).not.toContain(esc);
  });

  it('flattens k6 summary checks (any fail → failed case)', () => {
    const json = JSON.stringify({
      root_group: {
        checks: [
          { name: 'status is 200', passes: 10, fails: 0 },
          { name: 'body non-empty', passes: 8, fails: 2 },
        ],
        groups: {},
      },
    });
    const cases = parseK6Summary(json);
    expect(cases).toHaveLength(2);
    expect(cases[0]!.status).toBe('passed');
    expect(cases[1]!.status).toBe('failed');
  });
});
