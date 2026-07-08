<script lang="ts">
  import { onMount } from 'svelte';
  import { applyWriteback, getMe, getWriteTarget, type WriteResult, type WriteTargetInfo } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let target = $state<WriteTargetInfo | null>(null);
  let error = $state<string | null>(null);

  let title = $state('');
  let body = $state('');
  let labels = $state('');
  let approver = $state('');
  let approved = $state(false);
  let busy = $state(false);
  let result = $state<{ result: WriteResult; target: string } | null>(null);

  const ready = $derived(title.trim().length > 0 && approver.trim().length > 0 && approved);

  async function load() {
    try {
      target = await getWriteTarget();
      const me = await getMe();
      if (me) approver = me.email;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    }
  }

  async function apply() {
    if (!ready) return;
    busy = true;
    error = null;
    result = null;
    try {
      result = await applyWriteback({
        resource: 'issue',
        action: 'create',
        summary: title.trim(),
        payload: { title: title.trim(), body: body.trim(), ...(labels.trim() ? { labels: labels.split(',').map((l) => l.trim()).filter(Boolean) } : {}) },
        approver: approver.trim(),
      });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed';
    } finally {
      busy = false;
    }
  }
</script>

<section class="wrap">
  <div class="head">
    <h2>Write-back</h2>
    <p class="sub">
      The <b>only</b> way Arbiter writes anywhere. Create an issue in the connected repository — with your named approval and a full
      audit trail. It never touches the connected Jira workspace.
    </p>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if target}
    <div class="target {target.live ? 'live' : 'sandbox'}">
      <Icon name={target.id === 'github' ? 'writeback' : 'runner'} size={15} />
      {#if target.live}
        Writing to <b>{target.repo}</b> on GitHub.
      {:else}
        Preview mode — no GitHub repo configured, so writes are <b>simulated</b> in a sandbox (set GITHUB_TOKEN/OWNER/REPO to go live).
      {/if}
    </div>
  {/if}

  <section class="card">
    <label class="field">
      <span>Issue title *</span>
      <input placeholder="e.g. Checkout total off-by-one for coverage tier B" bind:value={title} />
    </label>
    <label class="field">
      <span>Description</span>
      <textarea rows="8" placeholder="What's the defect, steps to reproduce, expected vs actual…" bind:value={body}></textarea>
    </label>
    <label class="field">
      <span>Labels <span class="opt">optional, comma-separated</span></span>
      <input placeholder="bug, qa" bind:value={labels} />
    </label>

    <div class="approve">
      <label class="field">
        <span>Approved by *</span>
        <input placeholder="your.name@company.com" bind:value={approver} />
      </label>
      <label class="ack">
        <input type="checkbox" bind:checked={approved} />
        <span>I approve creating this issue. My name is recorded in the audit log.</span>
      </label>
    </div>

    <button class="primary" style="width:auto" disabled={busy || !ready} onclick={apply}>
      <Icon name="writeback" size={15} /> {busy ? 'Applying…' : 'Create issue'}
    </button>

    {#if result}
      {#if result.result.applied}
        <div class="banner good" style="margin-top:16px">
          <Icon name="validate" size={16} /> Created{result.result.verified ? ' & verified' : ''}.
          {#if result.result.reference?.startsWith('http')}
            <a href={result.result.reference} target="_blank" rel="noopener">{result.result.reference}</a>
          {:else}
            <code>{result.result.reference}</code> <span class="muted">({result.target})</span>
          {/if}
        </div>
      {:else}
        <div class="banner bad" style="margin-top:16px">Not applied — {result.result.reason ?? 'refused'}.</div>
      {/if}
    {/if}
  </section>
</section>

<style>
  .wrap {
    max-width: 760px;
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
  .target {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    padding: 10px 12px;
    border-radius: 9px;
    margin-bottom: 16px;
  }
  .target.live {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent-strong);
  }
  .target.sandbox {
    background: var(--surface-2, var(--panel));
    color: var(--muted);
  }
  .opt {
    color: var(--muted);
    font-weight: 400;
    font-size: 11px;
  }
  .approve {
    border-top: 1px solid var(--line);
    margin-top: 8px;
    padding-top: 14px;
  }
  .ack {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    margin: 4px 0 14px;
    cursor: pointer;
  }
  .ack input {
    margin-top: 2px;
  }
  .muted {
    color: var(--muted);
    font-size: 12px;
  }
</style>
