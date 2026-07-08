<script lang="ts">
  import { onMount } from 'svelte';
  import { addKnowledge, deleteKnowledge, listKnowledge, type KnowledgeDoc } from '$lib/api';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  let docs = $state<KnowledgeDoc[]>([]);
  let title = $state('');
  let content = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function load() {
    error = null;
    try {
      docs = await listKnowledge();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load knowledge';
    }
  }

  async function add() {
    if (!title.trim() || !content.trim()) return;
    busy = true;
    error = null;
    try {
      await addKnowledge({ title: title.trim(), content });
      title = '';
      content = '';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to add';
    } finally {
      busy = false;
    }
  }

  let pendingDelete = $state<KnowledgeDoc | null>(null);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  async function confirmDelete(confirmKey: string) {
    if (!pendingDelete) return;
    deleting = true;
    deleteError = null;
    try {
      await deleteKnowledge(pendingDelete.id, confirmKey);
      pendingDelete = null;
      await load();
    } catch (e) {
      deleteError = e instanceof Error ? e.message : 'Failed to delete';
    } finally {
      deleting = false;
    }
  }

  onMount(load);
</script>

<section class="wrap">
  <div class="head">
    <h2>Reference Docs</h2>
    <p class="sub">Your project's source material. Add specs, standards, or notes once; the AI pulls the relevant parts in automatically when you turn on “Use reference docs” — no need to re-paste. Sensitive info is hidden before anything is stored.</p>
  </div>

  {#if error}<div class="err">{error}</div>{/if}

  <section class="card">
    <h3>Add a document</h3>
    <input class="in" placeholder="Title (e.g. Login API schema v3)" bind:value={title} />
    <textarea class="in ta" placeholder="Paste schema / spec / requirements / notes…" bind:value={content}></textarea>
    <button class="primary" onclick={add} disabled={busy || !title.trim() || !content.trim()}>{busy ? 'Adding…' : 'Add to knowledge'}</button>
  </section>

  <section class="card">
    <h3>Documents ({docs.length})</h3>
    {#if docs.length === 0}
      <div class="muted">No knowledge yet — add a schema or spec above.</div>
    {:else}
      <ul class="list">
        {#each docs as d}
          <li>
            <div>
              <b>{d.title}</b>
              <span class="tag">{d.sourceType}</span>
              <span class="tag muted">{d.classification}</span>
            </div>
            <button class="ghost" onclick={() => { deleteError = null; pendingDelete = d; }} title="Delete">✕</button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
</section>

{#if pendingDelete}
  <ConfirmDialog
    title="Delete knowledge document"
    message={`Permanently delete "${pendingDelete.title}" and its chunks. It will no longer ground generated artifacts.`}
    busy={deleting}
    error={deleteError}
    oncancel={() => (pendingDelete = null)}
    onconfirm={confirmDelete}
  />
{/if}

<style>
  .wrap {
    max-width: 820px;
    margin: 0 auto;
    padding: 24px 20px 48px;
  }
  h2 {
    margin: 0;
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    margin: 4px 0 16px;
  }
  .card {
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
    margin-bottom: 14px;
  }
  .card h3 {
    margin: 0 0 10px;
    font-size: 13px;
  }
  .in {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--bg, #fff);
    color: var(--ink);
    font: inherit;
    margin-bottom: 8px;
  }
  .ta {
    min-height: 120px;
    resize: vertical;
    font-family: ui-monospace, monospace;
    font-size: 13px;
  }
  .primary {
    background: var(--accent-strong, #2563eb);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: 8px 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .tag {
    font-size: 11px;
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--accent-soft, #eef);
    margin-left: 6px;
  }
  .tag.muted {
    background: transparent;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
  }
  .err {
    color: var(--bad, #c0392b);
    margin-bottom: 12px;
  }
</style>
