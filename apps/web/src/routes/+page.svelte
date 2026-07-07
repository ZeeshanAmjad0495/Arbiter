<script lang="ts">
  import { onMount } from 'svelte';
  import {
    fetchJira,
    listWorkflows,
    runWorkflow,
    type ContextInput,
    type Outcome,
    type TestCase,
    type WorkflowMeta,
  } from '$lib/api';
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
  const selected = $derived(workflows.find((w) => w.id === selectedId));

  let requirement = $state('');
  let contexts = $state<ContextInput[]>([]);
  let riskTier = $state<'low' | 'medium' | 'high'>('medium');
  let autoApprove = $state(true);
  let simulateHallucination = $state(false);

  let loading = $state(false);
  let error = $state('');
  let outcome = $state<Outcome | null>(null);

  function applyWorkflow(meta: WorkflowMeta) {
    requirement = meta.ui.sampleRequirement;
    contexts = meta.ui.sampleContext
      ? [{ title: meta.ui.sampleContext.title, content: meta.ui.sampleContext.content, sourceType: 'schema' }]
      : [{ title: '', content: '', sourceType: 'paste' }];
    riskTier = meta.defaultRiskTier;
    simulateHallucination = false;
    outcome = null;
    error = '';
  }

  function selectWorkflow(id: string) {
    selectedId = id;
    const meta = workflows.find((w) => w.id === id);
    if (meta) applyWorkflow(meta);
  }

  onMount(async () => {
    try {
      workflows = await listWorkflows();
      const initial = workflows.find((w) => w.id === 'test-case') ?? workflows[0];
      if (initial) {
        selectedId = initial.id;
        applyWorkflow(initial);
      }
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
      });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
</script>

<nav class="wf-tabs">
  {#each workflows as w}
    <button type="button" class="wf-tab" class:active={w.id === selectedId} onclick={() => selectWorkflow(w.id)}>
      {w.label}
    </button>
  {/each}
</nav>

<main class="layout">
  <!-- Input -->
  <section class="panel input-panel">
    {#if selected}
      <h2>{selected.label}</h2>
      <p class="hint">{selected.description}</p>

      <label class="field">
        <span>{selected.ui.requirementLabel}</span>
        <textarea rows="5" placeholder={selected.ui.requirementPlaceholder} bind:value={requirement}></textarea>
      </label>

      {#each contexts as ctx, i}
        <div class="ctx-block">
          <div class="row">
            <input type="text" placeholder="Source title" bind:value={ctx.title} />
            {#if contexts.length > 1}
              <button class="ghost small" style="margin:0" type="button" onclick={() => removeContext(i)}>✕</button>
            {/if}
          </div>
          <textarea rows="3" placeholder="Paste schema / spec / ticket context…" bind:value={ctx.content}></textarea>
        </div>
      {/each}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="ghost small" style="margin:0" type="button" onclick={addContext}>+ Add context source</button>
        <input type="file" accept=".json,.yaml,.yml" bind:this={fileInput} onchange={onOpenApiFile} hidden />
        <button class="ghost small" style="margin:0" type="button" onclick={() => fileInput?.click()}>⬆ Upload OpenAPI / schema</button>
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
        {#if selected.ui.outputView === 'test_case'}
          <label class="check">
            <input type="checkbox" bind:checked={simulateHallucination} /> Simulate hallucination
          </label>
        {/if}
      </div>

      <button class="primary" type="button" onclick={run} disabled={loading}>
        {#if loading}<span class="spinner"></span> Running pipeline…{:else}Run {selected.label}{/if}
      </button>
      {#if error}<p class="error">{error}</p>{/if}
    {:else}
      <p class="hint">Loading workflows…</p>
      {#if error}<p class="error">{error}</p>{/if}
    {/if}
  </section>

  <!-- Output -->
  <section>
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
        <p>Pick a workflow and run it to see the guardrail pipeline in action.</p>
        <p style="font-size:13px">
          The same governed path — sanitize → ground → generate → validate → gate — runs for every workflow, with a
          full audit trail and trace.
        </p>
      </div>
    {/if}
  </section>
</main>

<style>
  .wf-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 14px 24px 0;
    max-width: 1400px;
    margin: 0 auto;
  }
  .wf-tab {
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 8px 8px 0 0;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
  }
  .wf-tab:hover {
    color: var(--ink);
  }
  .wf-tab.active {
    background: var(--surface);
    color: var(--accent-strong);
    border-bottom-color: var(--surface);
  }
</style>
