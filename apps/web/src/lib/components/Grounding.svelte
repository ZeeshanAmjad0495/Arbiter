<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { grounding }: { grounding: Outcome['grounding'] } = $props();

  function cls(s: string): string {
    return s === 'grounded' ? 'good' : s === 'ungrounded' ? 'bad' : 'warn';
  }
</script>

<article class="card">
  <h3>4 · Grounding validation</h3>
  {#if grounding.blockedExport}
    <div class="banner bad">⛔ {grounding.violations} ungrounded reference(s) — export blocked. An invented field can never ship.</div>
  {:else if grounding.claims.length}
    <div class="banner good">✓ All {grounding.claims.length} referenced fields exist in the provided context.</div>
  {/if}
  <div class="claims">
    {#each grounding.claims as c}
      <div class="chip-row">
        <span class="chip {cls(c.status)}">{c.status}</span>
        <b>{c.value}</b>
        <span style="color:var(--muted);font-size:11px">{c.kind}{c.foundIn ? ' · ' + c.foundIn : ''}</span>
      </div>
    {/each}
  </div>
</article>
