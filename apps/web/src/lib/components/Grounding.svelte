<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { grounding }: { grounding: Outcome['grounding'] } = $props();

  function cls(s: string): string {
    return s === 'grounded' ? 'good' : s === 'ungrounded' ? 'bad' : 'warn';
  }
  // Plain-language labels for each claim's status.
  const label: Record<string, string> = { grounded: 'backed by sources', ungrounded: 'not supported', unknown: 'unclear' };
</script>

<article class="card">
  <h3>4 · Source check</h3>
  {#if grounding.blockedExport}
    <div class="banner bad">⛔ {grounding.violations} detail{grounding.violations === 1 ? '' : 's'} not backed by your sources — can't be exported. Made-up details never ship.</div>
  {:else if grounding.claims.length}
    <div class="banner good">✓ All {grounding.claims.length} referenced detail{grounding.claims.length === 1 ? '' : 's'} are backed by the sources you provided.</div>
  {/if}
  <div class="claims">
    {#each grounding.claims as c}
      <div class="chip-row">
        <span class="chip {cls(c.status)}">{label[c.status] ?? c.status}</span>
        <b>{c.value}</b>
        <span style="color:var(--muted);font-size:11px">{c.foundIn ? 'found in ' + c.foundIn : ''}</span>
      </div>
    {/each}
  </div>
</article>
