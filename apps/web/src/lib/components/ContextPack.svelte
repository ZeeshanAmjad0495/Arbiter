<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { items }: { items: Outcome['contextPack'] } = $props();
</script>

<article class="card">
  <h3>2 · Context pack <span class="tag muted">{items.length} sources</span></h3>
  <div class="ctx-items">
    {#each items as it}
      <div class="chip-row">
        <span class="chip">{it.classification}</span>
        <b>{it.title}</b>
        <span style="margin-left:auto;color:var(--muted);font-size:11px">{it.citation}</span>
      </div>
    {:else}
      <div style="color:var(--muted);font-size:13px">No context sources provided.</div>
    {/each}
  </div>
</article>
