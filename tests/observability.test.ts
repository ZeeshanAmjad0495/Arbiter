import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { collectObservability, fetchSentryIssues, obsReadOnlyFetch } from '../apps/api/src/observability';

afterEach(() => vi.unstubAllGlobals());

describe('observability connectors are READ-ONLY (free/OSS: Sentry + Grafana)', () => {
  it('refuse any write method before a request is sent', async () => {
    // @ts-expect-error — deliberately passing a forbidden method
    await expect(obsReadOnlyFetch('https://x', {}, 'POST')).rejects.toThrow(/observability_write_forbidden/);
    // @ts-expect-error
    await expect(obsReadOnlyFetch('https://x', {}, 'DELETE')).rejects.toThrow(/read-only connector rejected/);
  });

  it('normalize Sentry issues into grounding-ready items', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify([{ shortId: 'ZUUB-1', title: 'TypeError: undefined is not a function', culprit: 'app/checkout', level: 'error', status: 'unresolved', count: '42', userCount: 7, permalink: 'https://sentry/x' }]), { status: 200 }));
    const config = loadConfig({ SENTRY_ORG: 'zuub', SENTRY_AUTH_TOKEN: 'tok' });
    const items = await fetchSentryIssues(config);
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toContain('ZUUB-1');
    expect(items[0]!.content).toContain('Culprit: app/checkout');
    expect(items[0]!.content).toContain('Events: 42');
  });

  it('return nothing when a source is not configured (no accidental calls)', async () => {
    const called = vi.fn();
    vi.stubGlobal('fetch', async () => (called(), new Response('[]')));
    expect(await fetchSentryIssues(loadConfig({}))).toEqual([]);
    expect(await collectObservability(loadConfig({}))).toEqual([]);
    expect(called).not.toHaveBeenCalled();
  });
});
