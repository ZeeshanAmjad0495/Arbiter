<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { san }: { san: Outcome['sanitization'] } = $props();
</script>

<article class="card">
  <h3>1 · Sanitization <span class="tag">{san.engine}</span> <span class="tag muted">{san.findings.length} findings</span></h3>
  {#if san.blocked}
    <div class="banner bad">⛔ Blocked before the model call. {san.blockReasons.join(' ')}</div>
  {/if}
  <div class="findings">
    {#each san.findings as f}
      <div class="chip-row">
        <span class="chip">{f.type}</span>
        <span style="color:var(--muted)">→</span>
        <span class="chip">{f.placeholder}</span>
        <span style="margin-left:auto;color:var(--muted);font-size:11px">{f.engine} · {f.score.toFixed(2)}</span>
      </div>
    {:else}
      <div style="color:var(--muted);font-size:13px">No PII or secrets detected.</div>
    {/each}
  </div>
  <details>
    <summary>Sanitized text (exactly what the model receives)</summary>
    <pre class="mono">{san.sanitizedText}</pre>
  </details>
</article>
