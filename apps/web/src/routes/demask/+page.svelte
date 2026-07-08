<script lang="ts">
  import { purgeDemask, resolveDemask } from '$lib/api';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';

  // Re-identify
  let masked = $state('');
  let resolving = $state(false);
  let resolved = $state<{ text: string; resolved: number; unresolved: number } | null>(null);
  let resolveError = $state<string | null>(null);

  // Retention
  let days = $state(30);
  let purging = $state(false);
  let purgeMsg = $state<string | null>(null);
  let purgeError = $state<string | null>(null);
  let confirmOpen = $state(false);

  async function reidentify() {
    if (!masked.trim()) return;
    resolving = true;
    resolveError = null;
    resolved = null;
    try {
      resolved = await resolveDemask(masked);
    } catch (e) {
      resolveError = e instanceof Error ? e.message : 'Failed';
    } finally {
      resolving = false;
    }
  }

  async function runPurge(confirmKey: string) {
    purging = true;
    purgeError = null;
    purgeMsg = null;
    try {
      const r = await purgeDemask(days * 24, confirmKey);
      purgeMsg = `Removed ${r.removed} mapping${r.removed === 1 ? '' : 's'}.`;
      confirmOpen = false;
    } catch (e) {
      purgeError = e instanceof Error ? e.message : 'Failed';
    } finally {
      purging = false;
    }
  }
</script>

<section class="wrap">
  <div class="head">
    <h2>Unmask data &amp; cleanup</h2>
    <p class="sub">
      Reveal the real values behind the hidden placeholders in an approved document you're handing off, and control how long those hidden
      values are kept. <b>Admins only</b> · limited to this project, and logged by count only (the real values are never written to the log).
    </p>
  </div>

  <div class="cols">
    <section class="card">
      <h3>Reveal real values</h3>
      <p class="muted">
        Paste text that contains hidden placeholders like <code>[EMAIL_ADDRESS_1]</code>. Only placeholders created in <b>this project</b> can be
        revealed; passwords and keys (<code>[…_REDACTED]</code>) are never stored, so they stay hidden.
      </p>
      <label class="field">
        <span>Text with hidden values</span>
        <textarea rows="9" class="mono-in" placeholder={'Contact [EMAIL_ADDRESS_1] regarding member [US_SSN_1]…'} bind:value={masked}></textarea>
      </label>
      <button class="primary" style="width:auto" disabled={resolving || !masked.trim()} onclick={reidentify}>
        <Icon name="demask" size={15} /> {resolving ? 'Revealing…' : 'Reveal values'}
      </button>
      {#if resolveError}<p class="error" role="alert">{resolveError}</p>{/if}
      {#if resolved}
        <div class="banner {resolved.unresolved > 0 ? 'warn' : 'good'}" style="margin-top:14px">
          Revealed {resolved.resolved} value{resolved.resolved === 1 ? '' : 's'}{resolved.unresolved > 0 ? ` · ${resolved.unresolved} stayed hidden (unknown or from another project)` : ''}.
        </div>
        <label class="field" style="margin-top:12px">
          <span>Revealed text — contains real personal data, handle per your policy</span>
          <textarea rows="9" class="mono-in danger" readonly value={resolved.text}></textarea>
        </label>
      {/if}
    </section>

    <section class="card">
      <h3>Cleanup</h3>
      <p class="muted">Permanently delete this project's hidden values once they're older than a cutoff. A scheduler can run this automatically.</p>
      <label class="field">
        <span>Delete hidden values older than</span>
        <div class="row">
          <input type="number" min="1" max="365" bind:value={days} style="width:90px" />
          <span class="unit">days</span>
        </div>
      </label>
      <button class="danger-btn" disabled={purging} onclick={() => { purgeError = null; confirmOpen = true; }}>
        <Icon name="trash" size={14} /> Delete old values
      </button>
      {#if purgeMsg}<div class="banner good" style="margin-top:12px">{purgeMsg}</div>{/if}
    </section>
  </div>
</section>

{#if confirmOpen}
  <ConfirmDialog
    title="Delete old hidden values"
    message={`Permanently delete this project's hidden values older than ${days} day(s). After this, those placeholders can no longer be revealed.`}
    confirmLabel="Delete old values"
    busy={purging}
    error={purgeError}
    oncancel={() => (confirmOpen = false)}
    onconfirm={runPurge}
  />
{/if}

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
    max-width: 760px;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 340px;
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
  .muted {
    color: var(--muted);
    font-size: 12.5px;
    margin: 0 0 12px;
  }
  code {
    font-family: ui-monospace, monospace;
    font-size: 11.5px;
    background: var(--surface-2, var(--panel));
    padding: 1px 5px;
    border-radius: 5px;
  }
  .mono-in {
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
  }
  .mono-in.danger {
    border-color: color-mix(in srgb, var(--bad) 45%, var(--line-strong));
    background: var(--bad-soft);
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .unit {
    color: var(--muted);
    font-size: 13px;
  }
  .banner.warn {
    background: var(--bad-soft);
    color: var(--bad);
  }
  .danger-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 14px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--bad) 55%, transparent);
    background: var(--bad-soft);
    color: var(--bad);
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  .danger-btn:disabled {
    opacity: 0.6;
  }
</style>
