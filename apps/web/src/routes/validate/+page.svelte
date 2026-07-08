<script lang="ts">
  import { onMount } from 'svelte';
  import { addSchema, deleteSchema, listSchemas, validateData, type SchemaInfo, type ValidateResult } from '$lib/api';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
  import Icon from '$lib/components/Icon.svelte';

  let schemas = $state<SchemaInfo[]>([]);
  let error = $state<string | null>(null);

  // add-schema form
  let newName = $state('');
  let newSchema = $state('');
  let adding = $state(false);

  // validate form
  let selectedId = $state('');
  let dataText = $state('');
  let validating = $state(false);
  let result = $state<ValidateResult | null>(null);
  let dataFileInput = $state<HTMLInputElement | null>(null);

  async function load() {
    error = null;
    try {
      schemas = await listSchemas();
      if (!selectedId && schemas.length) selectedId = schemas[0].id;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load schemas';
    }
  }

  async function add() {
    if (!newName.trim() || !newSchema.trim()) return;
    adding = true;
    error = null;
    try {
      await addSchema({ name: newName.trim(), schema: newSchema });
      newName = '';
      newSchema = '';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to add schema';
    } finally {
      adding = false;
    }
  }

  let pendingDelete = $state<SchemaInfo | null>(null);
  let deleting = $state(false);
  let deleteError = $state<string | null>(null);

  async function confirmDelete(confirmKey: string) {
    if (!pendingDelete) return;
    deleting = true;
    deleteError = null;
    try {
      await deleteSchema(pendingDelete.id, confirmKey);
      if (selectedId === pendingDelete.id) selectedId = '';
      pendingDelete = null;
      await load();
    } catch (e) {
      deleteError = e instanceof Error ? e.message : 'Failed to delete';
    } finally {
      deleting = false;
    }
  }

  async function onDataFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) dataText = await f.text();
    (e.target as HTMLInputElement).value = '';
  }

  async function validate() {
    if (!selectedId || !dataText.trim()) return;
    validating = true;
    result = null;
    error = null;
    try {
      result = await validateData(selectedId, dataText);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Validation failed';
    } finally {
      validating = false;
    }
  }

  onMount(load);
</script>

<section class="wrap">
  <div class="head">
    <h2>Schema Validator</h2>
    <p class="sub">Save this project's JSON Schemas once, then validate any data file against them — errors are reported by path.</p>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <div class="cols">
    <!-- Validate -->
    <section class="card">
      <h3>Validate data</h3>
      {#if schemas.length === 0}
        <p class="muted">Add a schema first, then validate data against it.</p>
      {:else}
        <label class="field">
          <span>Schema</span>
          <select bind:value={selectedId}>
            {#each schemas as s}<option value={s.id}>{s.name}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>Data (JSON)</span>
          <textarea rows="8" class="mono-in" placeholder={'{ "id": "SYN-1", "order_total": 42 }'} bind:value={dataText}></textarea>
        </label>
        <div class="row">
          <input type="file" accept=".json" bind:this={dataFileInput} onchange={onDataFile} hidden />
          <button class="ghost small" style="margin:0" onclick={() => dataFileInput?.click()}><Icon name="upload" size={14} /> Upload file</button>
          <button class="primary" style="width:auto" disabled={validating || !selectedId || !dataText.trim()} onclick={validate}>
            {validating ? 'Validating…' : 'Validate'}
          </button>
        </div>

        {#if result}
          {#if result.valid}
            <div class="banner good" style="margin-top:14px"><Icon name="validate" size={16} /> Valid — the data conforms to the schema.</div>
          {:else}
            <div class="banner bad" style="margin-top:14px">Invalid — {result.errors.length} error{result.errors.length === 1 ? '' : 's'}.</div>
            <ul class="errs">
              {#each result.errors as e}
                <li><code>{e.path}</code> <span>{e.message}</span> <span class="kw">{e.keyword}</span></li>
              {/each}
            </ul>
          {/if}
        {/if}
      {/if}
    </section>

    <!-- Schemas -->
    <section class="card">
      <h3>Saved schemas ({schemas.length})</h3>
      {#if schemas.length === 0}
        <p class="muted">No schemas yet.</p>
      {:else}
        <ul class="list">
          {#each schemas as s}
            <li><b>{s.name}</b><button class="ghost small" style="margin:0" aria-label="Delete schema" onclick={() => { deleteError = null; pendingDelete = s; }}><Icon name="trash" size={14} /></button></li>
          {/each}
        </ul>
      {/if}

      <div class="add">
        <h4>Add a schema</h4>
        <input class="in" placeholder="Schema name (e.g. Order v2)" bind:value={newName} />
        <textarea rows="6" class="in mono-in" placeholder={'{ "type": "object", "required": ["id"] }'} bind:value={newSchema}></textarea>
        <button class="ghost small" style="margin:0;display:inline-flex;align-items:center;gap:6px" disabled={adding || !newName.trim() || !newSchema.trim()} onclick={add}>
          <Icon name="plus" size={14} /> {adding ? 'Saving…' : 'Save schema'}
        </button>
      </div>
    </section>
  </div>
</section>

{#if pendingDelete}
  <ConfirmDialog
    title="Delete schema"
    message={`Permanently delete the schema "${pendingDelete.name}". Data files can no longer be validated against it.`}
    busy={deleting}
    error={deleteError}
    oncancel={() => (pendingDelete = null)}
    onconfirm={confirmDelete}
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
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 16px;
    align-items: start;
  }
  @media (max-width: 880px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .card h3 {
    margin: 0 0 12px;
    font-size: 14px;
  }
  .card h4 {
    margin: 14px 0 8px;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .row {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .in {
    width: 100%;
    box-sizing: border-box;
    margin-bottom: 8px;
  }
  .mono-in {
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
  }
  .list {
    list-style: none;
    margin: 0 0 4px;
    padding: 0;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--line);
  }
  .errs {
    list-style: none;
    margin: 10px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .errs li {
    display: flex;
    gap: 8px;
    align-items: baseline;
    font-size: 13px;
    padding: 7px 9px;
    border-radius: 7px;
    background: var(--bad-soft);
  }
  .errs code {
    font-family: ui-monospace, monospace;
    font-size: 12px;
    color: var(--bad);
    white-space: nowrap;
  }
  .errs .kw {
    margin-left: auto;
    font-size: 11px;
    color: var(--muted);
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
  }
</style>
