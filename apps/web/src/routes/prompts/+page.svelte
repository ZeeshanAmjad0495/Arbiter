<script lang="ts">
  import { onMount } from 'svelte';
  import { listPrompts, type PromptTemplate } from '$lib/api';

  let prompts = $state<PromptTemplate[]>([]);
  let error = $state('');

  onMount(async () => {
    try {
      prompts = await listPrompts();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  });
</script>

<main class="prompts-wrap">
  <div class="panel" style="margin-bottom:16px">
    <h2>Prompt Library</h2>
    <p class="hint">
      Versioned 6-component templates (Role · Context · Instruction · Constraints · Output format), seeded from the
      Arbisoft A1–A8 prompt pack. These are the single source of truth — each workflow's system prompt is composed
      from its template, so prompts are reviewable and diffable, never buried in code.
    </p>
    {#if error}<p class="error">{error}</p>{/if}
  </div>

  {#each prompts as p}
    <article class="card">
      <h3>{p.label} <span class="tag muted">{p.version}</span> <span class="tag">{p.components.origin}</span></h3>
      <div class="comp"><h4>Role</h4><div>{p.components.role}</div></div>
      <div class="comp"><h4>Context</h4><div>{p.components.context}</div></div>
      <div class="comp"><h4>Instruction</h4><div>{p.components.instruction}</div></div>
      <div class="comp">
        <h4>Constraints</h4>
        <ul>{#each p.components.constraints as c}<li>{c}</li>{/each}</ul>
      </div>
      <div class="comp"><h4>Output format</h4><div>{p.components.outputFormat}</div></div>
    </article>
  {/each}
</main>

<style>
  .prompts-wrap {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px 24px 48px;
  }
  .comp {
    margin: 10px 0;
  }
  .comp h4 {
    margin: 0 0 3px;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .comp div,
  .comp ul {
    font-size: 14px;
  }
  ul {
    margin: 0;
    padding-left: 20px;
  }
</style>
