<script lang="ts">
  import { onMount } from 'svelte';
  import { getStatus, listExecutions, runExecution, type StatusInfo, type TestExecution } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  const EXAMPLES: Record<'playwright' | 'k6', string> = {
    playwright: `import { test, expect } from '@playwright/test';

test('shopper adds an item to the cart', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add to cart' }).click();
  await expect(page.getByTestId('cart-count')).toHaveText('1');
});

test('checkout shows the correct order total', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByTestId('order-total')).toHaveText('$42.00');
});`,
    k6: `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = { vus: 5, duration: '10s' };

export default function () {
  const res = http.get('https://test.k6.io');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'p95 latency under 500ms': (r) => r.timings.duration < 500,
  });
  sleep(1);
}`,
  };

  let kind = $state<'playwright' | 'k6'>('playwright');
  let name = $state('');
  let script = $state('');
  let running = $state(false);
  let error = $state<string | null>(null);
  let result = $state<TestExecution | null>(null);
  let history = $state<TestExecution[]>([]);
  let runnerMode = $state<string | null>(null);

  async function load() {
    try {
      history = await listExecutions();
      const status: StatusInfo = await getStatus();
      runnerMode = status.modes.runner ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load history';
    }
  }

  function loadExample() {
    script = EXAMPLES[kind];
    if (!name.trim()) name = kind === 'playwright' ? 'Cart & checkout journey' : 'Homepage load profile';
  }

  async function run() {
    if (!script.trim()) return;
    running = true;
    error = null;
    result = null;
    try {
      result = await runExecution({ kind, script, name: name.trim() || undefined });
      history = await listExecutions();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Run failed';
    } finally {
      running = false;
    }
  }

  const pct = (e: TestExecution) => (e.summary.total ? Math.round((e.summary.passed / e.summary.total) * 100) : 0);
  const when = (iso: string) => new Date(iso).toLocaleString();

  onMount(load);
</script>

<section class="wrap">
  <div class="head">
    <h2>Test Runner</h2>
    <p class="sub">
      Execute an Arbiter-authored Playwright or k6 test with the real tool and read results back into your quality metrics.
      {#if runnerMode === 'offline'}
        <span class="mode-tag" title="Set ARBITER_RUNNER=real to spawn the real binary">Offline mode — results are simulated deterministically.</span>
      {:else if runnerMode === 'real'}
        <span class="mode-tag real">Real mode — spawning the actual binary.</span>
      {/if}
    </p>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="cols">
    <!-- Compose + run -->
    <section class="card">
      <div class="tabs">
        <button class:active={kind === 'playwright'} onclick={() => (kind = 'playwright')}>Playwright</button>
        <button class:active={kind === 'k6'} onclick={() => (kind = 'k6')}>k6</button>
      </div>
      <label class="field">
        <span>Run name <span class="opt">optional</span></span>
        <input placeholder={kind === 'playwright' ? 'Cart & checkout journey' : 'Homepage load profile'} bind:value={name} />
      </label>
      <label class="field">
        <span>{kind === 'playwright' ? 'Spec' : 'Script'} source</span>
        <textarea rows="16" class="mono-in" placeholder="Paste your test here…" bind:value={script}></textarea>
      </label>
      <div class="row">
        <button class="ghost small" style="margin:0" onclick={loadExample}><Icon name="upload" size={14} /> Load example</button>
        <button class="primary" style="width:auto" disabled={running || !script.trim()} onclick={run}>
          <Icon name="runner" size={15} /> {running ? 'Running…' : 'Run test'}
        </button>
      </div>

      {#if result}
        <div class="banner {result.status === 'passed' ? 'good' : result.status === 'failed' ? 'bad' : 'warn'}" style="margin-top:16px">
          {#if result.status === 'passed'}<Icon name="validate" size={16} /> All checks passed{/if}
          {#if result.status === 'failed'}{result.summary.failed} of {result.summary.total} failed{/if}
          {#if result.status === 'error'}Runner error — {result.error ?? 'no result produced'}{/if}
          <span class="mode-badge {result.mode}">{result.mode}</span>
        </div>
        {#if result.cases.length}
          <ul class="cases">
            {#each result.cases as c}
              <li class={c.status}>
                <span class="cbadge {c.status}">{c.status === 'passed' ? '✓' : c.status === 'failed' ? '✕' : '–'}</span>
                <span class="cname">{c.name}</span>
                {#if c.message}<span class="cmsg">{c.message}</span>{/if}
                <span class="cdur">{c.durationMs}ms</span>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    </section>

    <!-- History -->
    <section class="card">
      <h3>Recent runs ({history.length})</h3>
      {#if history.length === 0}
        <p class="muted">No runs yet — compose a test and hit Run.</p>
      {:else}
        <ul class="list">
          {#each history as e}
            <li>
              <span class="dot {e.status}"></span>
              <div class="hmeta">
                <b>{e.name}</b>
                <span class="hsub">{e.kind} · {e.summary.passed}/{e.summary.total} passed · {pct(e)}% · {when(e.createdAt)}</span>
              </div>
              <span class="mode-badge {e.mode}">{e.mode}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  </div>
</section>

<style>
  .wrap {
    max-width: 1040px;
    margin: 0 auto;
  }
  .head {
    margin-bottom: 18px;
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    margin: 4px 0 0;
  }
  .mode-tag {
    display: inline-block;
    margin-left: 4px;
    color: var(--muted);
    font-style: italic;
  }
  .mode-tag.real {
    color: var(--accent);
    font-style: normal;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 360px;
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 900px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .card h3 {
    margin: 0 0 12px;
    font-size: 14px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
  }
  .tabs button {
    padding: 6px 14px;
    border: 1px solid var(--line-strong);
    background: transparent;
    border-radius: 8px;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
  }
  .tabs button.active {
    background: var(--accent-strong);
    border-color: var(--accent-strong);
    color: #fff;
  }
  /* Dark theme flips to dark text on the light-indigo accent (matches .primary) for contrast. */
  :global(:root[data-theme='dark']) .tabs button.active {
    color: #171814;
  }
  .opt {
    color: var(--muted);
    font-weight: 400;
    font-size: 11px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }
  .mono-in {
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
  }
  .banner.warn {
    background: var(--bad-soft);
    color: var(--bad);
  }
  .mode-badge {
    margin-left: auto;
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    padding: 2px 7px;
    border-radius: 999px;
    background: var(--line);
    color: var(--muted);
  }
  .mode-badge.real {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }
  .cases {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .cases li {
    display: flex;
    align-items: baseline;
    gap: 9px;
    font-size: 13px;
    padding: 7px 9px;
    border-radius: 7px;
    background: var(--surface-2, var(--panel));
  }
  .cbadge {
    font-weight: 700;
    width: 14px;
    flex: none;
  }
  .cbadge.passed {
    color: var(--good);
  }
  .cbadge.failed {
    color: var(--bad);
  }
  .cbadge.skipped {
    color: var(--muted);
  }
  .cname {
    flex: 1;
    min-width: 0;
  }
  .cmsg {
    color: var(--bad);
    font-size: 11.5px;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cdur {
    color: var(--muted);
    font-size: 11px;
    flex: none;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 0;
    border-bottom: 1px solid var(--line);
  }
  .hmeta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }
  .hmeta b {
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hsub {
    color: var(--muted);
    font-size: 11.5px;
  }
  .dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    flex: none;
    background: var(--muted);
  }
  .dot.passed {
    background: var(--good);
  }
  .dot.failed {
    background: var(--bad);
  }
  .dot.error {
    background: #d9822b;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
</style>
