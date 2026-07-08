<script lang="ts">
  import Modal from './Modal.svelte';

  interface Props {
    title: string;
    message: string;
    confirmLabel?: string;
    /** Danger flow: require re-entering the access key + an explicit acknowledgement. */
    danger?: boolean;
    busy?: boolean;
    error?: string | null;
    oncancel: () => void;
    /** Receives the re-entered access key (empty string when danger=false). */
    onconfirm: (confirmKey: string) => void;
  }
  let { title, message, confirmLabel = 'Delete', danger = true, busy = false, error = null, oncancel, onconfirm }: Props = $props();

  let key = $state('');
  let ack = $state(false);
  const ready = $derived(!danger || (key.trim().length > 0 && ack));

  function submit() {
    if (ready && !busy) onconfirm(key.trim());
  }
</script>

<Modal {title} onclose={oncancel}>
  <p class="msg">{message}</p>
  {#if danger}
    <p class="backup">A compressed backup snapshot is saved before anything is deleted, so this can be recovered.</p>
    <label class="field">
      <span>Re-enter your access key to confirm</span>
      <input type="password" placeholder="ak_…" bind:value={key} onkeydown={(e) => e.key === 'Enter' && submit()} />
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={ack} />
      <span>I understand this is permanent and cannot be undone from the UI.</span>
    </label>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="actions">
    <button class="ghost" onclick={oncancel} disabled={busy}>Cancel</button>
    <button class="danger-btn" disabled={!ready || busy} onclick={submit}>{busy ? 'Working…' : confirmLabel}</button>
  </div>
</Modal>

<style>
  .msg {
    font-size: 13.5px;
    margin: 0 0 10px;
  }
  .backup {
    font-size: 12px;
    color: var(--muted);
    background: var(--surface-2, var(--panel));
    border-radius: 8px;
    padding: 8px 10px;
    margin: 0 0 14px;
  }
  .check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12.5px;
    color: var(--muted);
    margin-top: 10px;
    cursor: pointer;
  }
  .check input {
    margin-top: 2px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
  .danger-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 9px 16px;
    border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--bad) 55%, transparent);
    background: var(--bad);
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    cursor: pointer;
  }
  :global(:root[data-theme='dark']) .danger-btn {
    color: #171814;
  }
  .danger-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
