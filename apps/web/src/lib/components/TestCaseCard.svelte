<script lang="ts">
  import type { TestCase } from '$lib/api';
  let { output, model }: { output: TestCase | null; model: string } = $props();
</script>

<article class="card">
  <h3>3 · Generated test case <span class="tag muted">{model}</span></h3>
  {#if output}
    <div class="tc-head">
      <div class="tc-title">{output.title}</div>
      <span class="chip">{output.testType}</span>
      <span class="chip">priority: {output.priority}</span>
    </div>
    {#if output.preconditions.length}
      <div class="tc-section">
        <h4>Preconditions</h4>
        <ul>{#each output.preconditions as p}<li>{p}</li>{/each}</ul>
      </div>
    {/if}
    <div class="tc-section">
      <h4>Steps</h4>
      <ol>{#each output.steps as s}<li>{s}</li>{/each}</ol>
    </div>
    <div class="tc-section">
      <h4>Expected result</h4>
      <div>{output.expectedResult}</div>
    </div>
    <div class="tc-section">
      <h4>Fields referenced</h4>
      <div>{#each output.fieldsReferenced as f}<span class="chip" style="margin:0 4px 4px 0;display:inline-block">{f}</span>{/each}</div>
    </div>
    {#if output.assumptions.length}
      <div class="tc-section">
        <h4>Assumptions</h4>
        <ul>{#each output.assumptions as a}<li>{a}</li>{/each}</ul>
      </div>
    {/if}
    {#if output.gherkin}
      <div class="tc-section">
        <h4>Gherkin</h4>
        <pre class="mono">{output.gherkin}</pre>
      </div>
    {/if}
  {:else}
    <div style="color:var(--muted)">No artifact — the run short-circuited before generation.</div>
  {/if}
</article>
