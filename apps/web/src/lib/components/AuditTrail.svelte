<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { audit }: { audit: Outcome['audit'] } = $props();

  function fmt(iso: string): string {
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }
</script>

<article class="card">
  <h3>Audit trail <span class="tag muted">{audit.length} events</span></h3>
  <div class="audit">
    {#each audit as a}
      <div class="chip-row">
        <span class="chip">{a.action}</span>
        <time>{fmt(a.at)}</time>
      </div>
    {/each}
  </div>
</article>
