<script lang="ts">
  import { onMount } from 'svelte';
  import { getArtifact, listReviews, submitReview, type Artifact, type ReviewItem, type ReviewLog } from '$lib/api';

  let items = $state<ReviewItem[]>([]);
  let loadingList = $state(true);
  let listError = $state('');

  let selectedId = $state<string | null>(null);
  let artifact = $state<Artifact | null>(null);
  let history = $state<ReviewLog[]>([]);
  let editedJson = $state('');
  let originalJson = $state('');
  let jsonError = $state('');
  let openedAtMs = 0;
  let submitting = $state('');
  let flash = $state('');
  let lastDiff = $state('');

  async function loadList() {
    loadingList = true;
    listError = '';
    try {
      items = await listReviews();
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    } finally {
      loadingList = false;
    }
  }

  async function open(id: string) {
    selectedId = id;
    flash = '';
    lastDiff = '';
    jsonError = '';
    try {
      const detail = await getArtifact(id);
      artifact = detail.artifact;
      history = detail.reviews;
      originalJson = JSON.stringify(detail.artifact.content, null, 2);
      editedJson = originalJson;
      openedAtMs = Date.now();
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    }
  }

  async function decide(decision: 'approved' | 'rejected' | 'needs_changes') {
    if (!artifact) return;
    jsonError = '';
    let editedContent: unknown | undefined;
    if (editedJson !== originalJson) {
      try {
        editedContent = JSON.parse(editedJson);
      } catch {
        jsonError = 'Edited content is not valid JSON — fix it before submitting.';
        return;
      }
    }
    submitting = decision;
    try {
      const result = await submitReview(artifact.id, {
        decision,
        ...(editedContent !== undefined ? { editedContent } : {}),
        dwellMs: Date.now() - openedAtMs,
      });
      lastDiff = result.review.editDiff ?? '';
      flash = `Recorded: ${decision.replace('_', ' ')}${result.review.editDiff ? ' (edits captured)' : ''}.`;
      artifact = null;
      selectedId = null;
      await loadList();
    } catch (e) {
      jsonError = e instanceof Error ? e.message : String(e);
    } finally {
      submitting = '';
    }
  }

  onMount(loadList);
</script>

<section class="layout">
  <section class="panel input-panel">
    <h2>Review Queue <span class="tag muted">{items.length}</span></h2>
    <p class="hint">
      Documents waiting for your approval (create one with <b>Skip review</b> off to add items here). High- and
      medium-risk items need sign-off before they're used. Any edits you make are saved as feedback that improves future drafts.
    </p>
    {#if loadingList}
      <p class="hint">Loading…</p>
    {:else if listError}
      <p class="error">{listError}</p>
    {:else if items.length === 0}
      <div class="empty" style="padding:30px 16px">No artifacts awaiting review.</div>
    {:else}
      <div class="findings">
        {#each items as it}
          <button class="queue-item" class:sel={it.id === selectedId} onclick={() => open(it.id)}>
            <div class="qi-top">
              <span class="chip">{it.type}</span>
              <span class="chip {it.riskTier === 'high' ? 'bad' : it.riskTier === 'medium' ? 'warn' : 'good'}">{it.riskTier}</span>
            </div>
            <div class="qi-title">{it.summary}</div>
          </button>
        {/each}
      </div>
    {/if}
    {#if flash}<p class="banner good" style="margin-top:12px">{flash}</p>{/if}
  </section>

  <section>
    {#if artifact}
      <article class="card">
        <h3>
          Review document <span class="tag muted">{artifact.type}</span>
          <span class="tag muted">{artifact.model ?? ''}</span>
          <span class="badge {artifact.riskTier === 'high' ? 'rejected' : artifact.riskTier === 'medium' ? 'needs_changes' : 'approved'}">
            {artifact.riskTier} risk
          </span>
        </h3>
        <p class="hint">Edit the content below if needed, then choose a decision. Your changes are saved as feedback.</p>
        <textarea class="json-edit mono" rows="16" bind:value={editedJson}></textarea>
        {#if jsonError}<p class="error">{jsonError}</p>{/if}
        <div class="review-actions">
          <button class="primary" style="width:auto" disabled={!!submitting} onclick={() => decide('approved')}>
            {submitting === 'approved' ? 'Saving…' : 'Approve'}
          </button>
          <button class="ghost" disabled={!!submitting} onclick={() => decide('needs_changes')}>Request changes</button>
          <button class="ghost" disabled={!!submitting} onclick={() => decide('rejected')}>Reject</button>
        </div>
      </article>

      {#if history.length > 0}
        <article class="card">
          <h3>Prior decisions</h3>
          <div class="audit">
            {#each history as r}
              <div class="chip-row">
                <span class="badge {r.decision}">{r.decision.replace('_', ' ')}</span>
                <span style="color:var(--muted);font-size:11px">{r.decidedAt ?? r.createdAt}{r.editDiff ? ' · edited' : ''}</span>
              </div>
            {/each}
          </div>
        </article>
      {/if}
    {:else if lastDiff}
      <article class="card">
        <h3>Your saved edits</h3>
        <pre class="mono">{lastDiff}</pre>
      </article>
    {:else}
      <div class="empty"><p>Pick a document from the queue to review it.</p></div>
    {/if}
  </section>
</section>

<style>
  .queue-item {
    text-align: left;
    width: 100%;
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px;
    cursor: pointer;
  }
  .queue-item:hover {
    border-color: var(--accent);
  }
  .queue-item.sel {
    border-color: var(--accent-strong);
    background: var(--accent-soft);
  }
  .qi-top {
    display: flex;
    gap: 6px;
    margin-bottom: 4px;
  }
  .qi-title {
    font-size: 13px;
    color: var(--ink);
  }
  .json-edit {
    width: 100%;
    background: var(--field);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px;
  }
  .review-actions {
    display: flex;
    gap: 8px;
    margin-top: 10px;
    flex-wrap: wrap;
  }
</style>
