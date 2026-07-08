<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    fetchJira,
    listWorkflows,
    runWorkflow,
    type ContextInput,
    type Outcome,
    type TestCase,
    type WorkflowMeta,
  } from '$lib/api';
  import { CATEGORIES, categoryOf } from '$lib/catalog';
  import Icon from '$lib/components/Icon.svelte';
  import Pipeline from '$lib/components/Pipeline.svelte';
  import Sanitization from '$lib/components/Sanitization.svelte';
  import ContextPack from '$lib/components/ContextPack.svelte';
  import TestCaseCard from '$lib/components/TestCaseCard.svelte';
  import GenericOutput from '$lib/components/GenericOutput.svelte';
  import Grounding from '$lib/components/Grounding.svelte';
  import ReviewGate from '$lib/components/ReviewGate.svelte';
  import AuditTrail from '$lib/components/AuditTrail.svelte';
  import Trace from '$lib/components/Trace.svelte';
  import Export from '$lib/components/Export.svelte';
  import { openApiToContext } from '$lib/openapi';

  let workflows = $state<WorkflowMeta[]>([]);
  let selectedId = $state('');
  let search = $state('');
  const selected = $derived(workflows.find((w) => w.id === selectedId));

  let requirement = $state('');
  let contexts = $state<ContextInput[]>([]);
  let riskTier = $state<'low' | 'medium' | 'high'>('medium');
  let autoApprove = $state(true);
  let simulateHallucination = $state(false);
  let useKnowledge = $state(false);
  let useGraph = $state(false);

  let loading = $state(false);
  let error = $state('');
  let outcome = $state<Outcome | null>(null);

  // The active category comes from ?cat (the sidebar sub-items). Search is global.
  const currentCat = $derived($page.url.searchParams.get('cat') ?? 'author');
  const activeCategory = $derived(CATEGORIES.find((c) => c.key === currentCat) ?? CATEGORIES[0]);
  const q = $derived(search.trim().toLowerCase());
  const searching = $derived(q.length > 0);
  function matches(w: WorkflowMeta): boolean {
    return !q || w.label.toLowerCase().includes(q) || w.description.toLowerCase().includes(q);
  }
  const groups = $derived(
    searching
      ? CATEGORIES.map((c) => ({ ...c, items: workflows.filter((w) => categoryOf(w.id) === c.key && matches(w)) })).filter((g) => g.items.length > 0)
      : [{ ...activeCategory, items: workflows.filter((w) => categoryOf(w.id) === activeCategory.key) }],
  );
  const matchCount = $derived(groups.reduce((n, g) => n + g.items.length, 0));

  // Switching category (sidebar) returns to that category's catalog.
  let lastCat = $state('');
  $effect(() => {
    if (currentCat !== lastCat) {
      lastCat = currentCat;
      selectedId = '';
    }
  });

  // A workflow opens with a BLANK form (the project's own inputs), not demo data.
  function resetForm(meta: WorkflowMeta) {
    requirement = '';
    contexts = [{ title: '', content: '', sourceType: 'paste' }];
    riskTier = meta.defaultRiskTier;
    simulateHallucination = false;
    outcome = null;
    error = '';
  }

  // Opt-in: load the illustrative sample for this workflow.
  function loadExample() {
    if (!selected) return;
    requirement = selected.ui.sampleRequirement;
    contexts = selected.ui.sampleContext
      ? [{ title: selected.ui.sampleContext.title, content: selected.ui.sampleContext.content, sourceType: 'schema' }]
      : [{ title: '', content: '', sourceType: 'paste' }];
  }

  function openWorkflow(id: string) {
    selectedId = id;
    const meta = workflows.find((w) => w.id === id);
    if (meta) resetForm(meta);
    window.scrollTo({ top: 0 });
  }
  function backToCatalog() {
    selectedId = '';
    outcome = null;
    error = '';
  }

  onMount(async () => {
    try {
      workflows = await listWorkflows();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });

  let fileInput = $state<HTMLInputElement | null>(null);
  let jiraKey = $state('');
  let jiraBusy = $state(false);

  async function fetchJiraTicket() {
    if (!jiraKey.trim()) return;
    jiraBusy = true;
    error = '';
    try {
      const ctx = await fetchJira(jiraKey.trim());
      contexts = [...contexts.filter((c) => c.content.trim()), ctx];
      jiraKey = '';
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      jiraBusy = false;
    }
  }

  function addContext() {
    contexts = [...contexts, { title: '', content: '', sourceType: 'paste' }];
  }
  function removeContext(i: number) {
    contexts = contexts.filter((_, idx) => idx !== i);
  }
  async function onOpenApiFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const ctx = openApiToContext(await file.text(), file.name);
      contexts = [...contexts.filter((c) => c.content.trim()), ctx];
    } catch (err) {
      error = `Could not parse OpenAPI/schema: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      input.value = '';
    }
  }

  async function run() {
    loading = true;
    error = '';
    try {
      outcome = await runWorkflow(selectedId, {
        requirement,
        context: contexts.filter((c) => c.content.trim().length > 0),
        riskTier,
        autoApprove,
        simulateHallucination,
        useKnowledge,
        useGraph,
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
</script>

{#if !selected}
  <!-- ===== Catalog ===== -->
  <div class="catalog-head">
    <div>
      <h2>{searching ? 'Search results' : activeCategory.label}</h2>
      <p class="sub">{searching ? `${matchCount} matching workflow${matchCount === 1 ? '' : 's'}` : activeCategory.blurb}</p>
    </div>
    <div class="search">
      <Icon name="search" size={16} class="op5" />
      <input type="search" placeholder="Search all workflows…" bind:value={search} aria-label="Search workflows" />
    </div>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if workflows.length === 0 && !error}<div class="empty">Loading workflows…</div>{/if}
  {#if searching && matchCount === 0}<div class="empty">No workflows match “{search}”.</div>{/if}

  {#each groups as g}
    <section class="cat-group">
      {#if searching}
        <h3><span class="cat-ico"><Icon name={g.key} size={15} /></span> {g.label} <span style="opacity:.5">· {g.items.length}</span></h3>
      {/if}
      <div class="cat-grid">
        {#each g.items as w}
          <button class="wf-card" onclick={() => openWorkflow(w.id)}>
            <span class="wf-name"><span class="wf-ico" aria-hidden="true"><Icon name={categoryOf(w.id)} size={16} /></span>{w.label}</span>
            <span class="wf-desc">{w.description}</span>
            <span style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted);margin-top:2px">
              <span class="risk-dot {w.defaultRiskTier}"></span>{w.defaultRiskTier} risk
            </span>
          </button>
        {/each}
      </div>
    </section>
  {/each}
{:else}
  <!-- ===== Run view ===== -->
  <div class="runview-top">
    <button class="back-link" onclick={backToCatalog}><Icon name="back" size={15} /> Workflows</button>
    <div style="display:flex;align-items:center;gap:8px">
      <span aria-hidden="true" style="display:inline-flex"><Icon name={categoryOf(selected.id)} size={18} /></span>
      <strong style="font-size:16px">{selected.label}</strong>
      <span class="risk-dot {selected.defaultRiskTier}" title="{selected.defaultRiskTier} risk"></span>
    </div>
    <button class="ghost small" style="margin:0 0 0 auto" type="button" onclick={loadExample}>Load example</button>
  </div>

  <div class="layout">
    <!-- Input -->
    <section class="panel input-panel">
      <p class="hint" style="margin-top:0">{selected.description}</p>

      <label class="field">
        <span>{selected.ui.requirementLabel}</span>
        <textarea rows="5" placeholder={selected.ui.requirementPlaceholder} bind:value={requirement}></textarea>
      </label>

      {#each contexts as ctx, i}
        <div class="ctx-block">
          <div class="row">
            <input type="text" placeholder="Source title" bind:value={ctx.title} />
            {#if contexts.length > 1}
              <button class="ghost small" style="margin:0;display:inline-flex" type="button" aria-label="Remove context" onclick={() => removeContext(i)}><Icon name="close" size={14} /></button>
            {/if}
          </div>
          <textarea rows="3" placeholder="Paste schema / spec / ticket context…" bind:value={ctx.content}></textarea>
        </div>
      {/each}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="ghost small" style="margin:0" type="button" onclick={addContext}>+ Add context source</button>
        <input type="file" accept=".json,.yaml,.yml" bind:this={fileInput} onchange={onOpenApiFile} hidden />
        <button class="ghost small" style="margin:0;display:inline-flex;align-items:center;gap:6px" type="button" onclick={() => fileInput?.click()}><Icon name="upload" size={14} /> Upload OpenAPI / schema</button>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:12px">
        <input type="text" placeholder="Jira key (e.g. BOT-123)" bind:value={jiraKey} style="flex:1" />
        <button class="ghost small" style="margin:0" type="button" disabled={jiraBusy} onclick={fetchJiraTicket}>
          {jiraBusy ? 'Fetching…' : 'Fetch Jira'}
        </button>
      </div>

      <div class="controls">
        <label class="field inline">
          <span>Risk tier</span>
          <select bind:value={riskTier}>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" bind:checked={autoApprove} /> Auto-approve (demo)</label>
        <label class="check" title="Retrieve relevant chunks from this project's Knowledge into the context (RAG)">
          <input type="checkbox" bind:checked={useKnowledge} /> Use project knowledge
        </label>
        <label class="check" title="Add connected entities from the project's Knowledge Graph (GraphRAG)">
          <input type="checkbox" bind:checked={useGraph} /> Use graph
        </label>
        {#if selected.ui.outputView === 'test_case'}
          <label class="check">
            <input type="checkbox" bind:checked={simulateHallucination} /> Simulate hallucination
          </label>
        {/if}
      </div>

      <button class="primary" type="button" onclick={run} disabled={loading} aria-busy={loading}>
        {#if loading}<span class="spinner" aria-hidden="true"></span> Running pipeline…{:else}Run {selected.label}{/if}
      </button>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </section>

    <!-- Output -->
    <section aria-live="polite">
      {#if outcome}
        <div class="panel" style="margin-bottom:14px;padding:14px 18px">
          <Pipeline {outcome} />
          <div style="font-size:12px;color:var(--muted)">run {outcome.runId}</div>
        </div>
        {#if outcome.output}
          <Export label={selected?.label ?? 'Output'} output={outcome.output} runId={outcome.runId} />
        {/if}
        <Sanitization san={outcome.sanitization} />
        <ContextPack items={outcome.contextPack} />
        {#if outcome.outputView === 'test_case'}
          <TestCaseCard output={outcome.output as TestCase} model={outcome.model} />
        {:else}
          <GenericOutput output={outcome.output} model={outcome.model} label={selected?.label ?? 'Output'} />
        {/if}
        {#if outcome.grounding.claims.length > 0 || outcome.grounding.blockedExport}
          <Grounding grounding={outcome.grounding} />
        {/if}
        <ReviewGate review={outcome.review} />
        <AuditTrail audit={outcome.audit} />
        <Trace trace={outcome.trace} />
      {:else}
        <div class="empty">
          <p>Fill in the input and run to see the guardrail pipeline in action.</p>
          <p style="font-size:13px">sanitize → ground → generate → validate → gate — with a full audit trail and trace.</p>
        </div>
      {/if}
    </section>
  </div>
{/if}
