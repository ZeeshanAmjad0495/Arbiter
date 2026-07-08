<script lang="ts">
  import { onMount } from 'svelte';
  import { getMetrics, type QualityMetrics } from '$lib/api';

  let metrics = $state<QualityMetrics | null>(null);
  let error = $state<string | null>(null);

  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const dwell = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`);
  const humanize = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  async function load() {
    error = null;
    try {
      metrics = await getMetrics();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load metrics';
    }
  }

  onMount(load);
</script>

<section class="wrap">
  <div class="head">
    <div>
      <h2>Quality Insights</h2>
      <p class="sub">The project's quality trend line — aggregated from captured signals, never mutated.</p>
    </div>
    <button class="ghost" type="button" onclick={load}>Refresh</button>
  </div>

  {#if error}
    <div class="err">{error}</div>
  {:else if !metrics}
    <div class="muted">Loading…</div>
  {:else}
    <section class="stats">
      <div class="stat"><span class="label">Artifacts</span><b>{metrics.totals.artifacts}</b></div>
      <div class="stat"><span class="label">Reviews decided</span><b>{metrics.review.decided}</b></div>
      <div class="stat"><span class="label">Approval rate</span><b>{pct(metrics.review.approvalRate)}</b></div>
      <div class="stat"><span class="label">Reviewer-edit rate</span><b>{pct(metrics.review.editRate)}</b></div>
      <div class="stat"><span class="label">Median dwell</span><b>{dwell(metrics.review.medianDwellMs)}</b></div>
      <div class="stat" class:warn={(metrics.grounding.violationRate ?? 0) > 0}>
        <span class="label">Grounding-violation rate</span><b>{pct(metrics.grounding.violationRate)}</b>
      </div>
    </section>

    <div class="cols">
      <section class="card">
        <h3>By status</h3>
        <ul class="kv">
          {#each Object.entries(metrics.byStatus) as [k, v]}
            <li><span>{humanize(k)}</span><b>{v}</b></li>
          {/each}
        </ul>
      </section>
      <section class="card">
        <h3>By risk tier</h3>
        <ul class="kv">
          {#each Object.entries(metrics.byRiskTier) as [k, v]}
            <li><span>{humanize(k)}</span><b>{v}</b></li>
          {/each}
        </ul>
      </section>
    </div>

    <section class="card">
      <h3>By workflow</h3>
      {#if metrics.byWorkflow.length === 0}
        <div class="muted">No runs yet.</div>
      {:else}
        <table>
          <thead><tr><th>Workflow</th><th>Runs</th><th>Approved</th><th>Rejected</th></tr></thead>
          <tbody>
            {#each metrics.byWorkflow as w}
              <tr><td>{humanize(w.type)}</td><td>{w.count}</td><td>{w.approved}</td><td>{w.rejected}</td></tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </section>

    <section class="card">
      <h3>Test execution</h3>
      {#if metrics.execution.runs === 0}
        <div class="muted">No test runs yet — execute a Playwright or k6 test in the <a href="/runner">Test Runner</a>.</div>
      {:else}
        <ul class="kv">
          <li><span>Runs</span><b>{metrics.execution.runs}</b></li>
          <li><span>Run pass rate</span><b>{pct(metrics.execution.passRate)}</b></li>
          <li><span>Cases passed</span><b>{metrics.execution.cases.passed}</b></li>
          <li class:warn={metrics.execution.cases.failed > 0}><span>Cases failed</span><b>{metrics.execution.cases.failed}</b></li>
        </ul>
        {#if metrics.execution.byKind.length}
          <table style="margin-top:10px">
            <thead><tr><th>Tool</th><th>Runs</th><th>Passed</th><th>Failed</th></tr></thead>
            <tbody>
              {#each metrics.execution.byKind as k}
                <tr><td>{k.kind}</td><td>{k.runs}</td><td>{k.passed}</td><td>{k.failed}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
      {/if}
    </section>

    <p class="ts">Generated {new Date(metrics.generatedAt).toLocaleString()}</p>
  {/if}
</section>

<style>
  .wrap {
    max-width: 960px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 18px;
  }
  h2 {
    margin: 0;
  }
  .sub {
    color: var(--muted);
    margin: 4px 0 0;
    font-size: 13px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 12px;
    margin-bottom: 18px;
  }
  .stat {
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .stat b {
    font-size: 24px;
  }
  .stat.warn b {
    color: var(--bad, #c0392b);
  }
  .label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 12px;
  }
  .card {
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 12px;
  }
  .card h3 {
    margin: 0 0 10px;
    font-size: 13px;
  }
  .kv {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .kv li {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid var(--line);
    font-size: 14px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th,
  td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
  }
  th {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
  }
  .muted {
    color: var(--muted);
  }
  .err {
    color: var(--bad, #c0392b);
  }
  .ts {
    color: var(--muted);
    font-size: 12px;
    margin-top: 16px;
  }
  @media (max-width: 640px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
</style>
