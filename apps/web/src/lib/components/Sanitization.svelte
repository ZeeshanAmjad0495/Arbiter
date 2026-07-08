<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { san }: { san: Outcome['sanitization'] } = $props();
</script>

<article class="card">
  <h3>1 · Privacy check <span class="tag muted">{san.findings.length} item{san.findings.length === 1 ? '' : 's'} hidden</span></h3>
  {#if san.blocked}
    <div class="banner bad">⛔ Stopped before sending to the AI. {san.blockReasons.join(' ')}</div>
  {/if}
  <div class="findings">
    {#each san.findings as f}
      <div class="chip-row">
        <span class="chip">{f.type}</span>
        <span style="color:var(--muted)">→ hidden as</span>
        <span class="chip">{f.placeholder}</span>
        <span style="margin-left:auto;color:var(--muted);font-size:11px">confidence {f.score.toFixed(2)}</span>
      </div>
    {:else}
      <div style="color:var(--muted);font-size:13px">No sensitive info or secrets found.</div>
    {/each}
  </div>
  <details>
    <summary>Cleaned text (exactly what the AI sees)</summary>
    <pre class="mono">{san.sanitizedText}</pre>
  </details>
</article>
