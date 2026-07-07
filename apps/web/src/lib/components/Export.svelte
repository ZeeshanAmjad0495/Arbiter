<script lang="ts">
  import { download, gherkinOf, toCsv, toMarkdown } from '$lib/export';

  let { label, output, runId }: { label: string; output: unknown; runId: string } = $props();

  const base = $derived(`arbiter-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${runId.slice(0, 8)}`);
  const gherkin = $derived(gherkinOf(output));
</script>

{#if output}
  <div class="export-bar">
    <span class="hint" style="margin:0">Export:</span>
    <button class="ghost small" style="margin:0" onclick={() => download(`${base}.md`, toMarkdown(label, output), 'text/markdown')}>Markdown</button>
    <button class="ghost small" style="margin:0" onclick={() => download(`${base}.json`, JSON.stringify(output, null, 2), 'application/json')}>JSON</button>
    <button class="ghost small" style="margin:0" onclick={() => download(`${base}.csv`, toCsv(output), 'text/csv')}>CSV</button>
    {#if gherkin}
      <button class="ghost small" style="margin:0" onclick={() => download(`${base}.feature`, gherkin, 'text/plain')}>Gherkin</button>
    {/if}
  </div>
{/if}

<style>
  .export-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0 0 14px;
    padding: 8px 10px;
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 8px;
  }
</style>
