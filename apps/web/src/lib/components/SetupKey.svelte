<script lang="ts">
  import { rotateKey } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let { email, ondone }: { email: string; ondone: () => void } = $props();

  let busy = $state(false);
  let error = $state<string | null>(null);
  let key = $state<string | null>(null);
  let copied = $state(false);
  let acknowledged = $state(false);

  async function generate() {
    busy = true;
    error = null;
    try {
      key = await rotateKey();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to generate key';
    } finally {
      busy = false;
    }
  }

  async function copy() {
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      copied = true;
    } catch {
      /* clipboard blocked — the user can select the text manually */
    }
  }
</script>

<main class="wrap">
  <div class="card">
    <div class="brand"><span class="mark"><Icon name="scale" size={24} strokeWidth={2.25} /></span> Arbiter</div>
    {#if !key}
      <h2>Set up your access key</h2>
      <p class="sub">Welcome, <b>{email}</b>. You signed in with a temporary key. Generate your own permanent access key now — you'll use it to sign in from here on.</p>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="primary" disabled={busy} onclick={generate}>
        <Icon name="demask" size={15} /> {busy ? 'Generating…' : 'Generate my access key'}
      </button>
    {:else}
      <h2>Save your access key</h2>
      <p class="sub">This is shown <b>once</b>. Copy it and keep it somewhere safe — you won't be able to see it again. If you lose it, email an admin to be re-invited.</p>
      <div class="keybox">
        <code>{key}</code>
        <button class="ghost small" style="margin:0" onclick={copy}><Icon name={copied ? 'validate' : 'upload'} size={14} /> {copied ? 'Copied' : 'Copy'}</button>
      </div>
      <label class="ack">
        <input type="checkbox" bind:checked={acknowledged} />
        <span>I've saved my access key somewhere safe.</span>
      </label>
      <button class="primary" disabled={!acknowledged} onclick={ondone}>Continue to Arbiter</button>
    {/if}
  </div>
</main>

<style>
  .wrap {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 440px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 28px;
    box-shadow: var(--shadow-lg);
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 9px;
    font-weight: 700;
    font-size: 18px;
    margin-bottom: 16px;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  h2 {
    margin: 0 0 6px;
    font-size: 18px;
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    margin: 0 0 18px;
  }
  .primary {
    width: 100%;
  }
  .keybox {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface-2, var(--bg));
    border: 1px solid var(--line-strong);
    border-radius: 9px;
    padding: 10px 12px;
    margin-bottom: 14px;
  }
  .keybox code {
    flex: 1;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    word-break: break-all;
  }
  .ack {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    margin-bottom: 18px;
    cursor: pointer;
  }
  .ack input {
    margin-top: 2px;
  }
</style>
