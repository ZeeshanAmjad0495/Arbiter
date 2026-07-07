<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { trace }: { trace: Outcome['trace'] } = $props();
</script>

{#if trace}
  <article class="card">
    <h3>Trace</h3>
    <pre class="mono trace">{trace.text}</pre>
  </article>
{/if}
