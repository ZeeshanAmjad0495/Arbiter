<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { review }: { review: Outcome['review'] } = $props();
</script>

<article class="card">
  <h3>5 · Review gate</h3>
  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span class="badge {review.decision}">{review.decision.replace('_', ' ')}</span>
    <span style="color:var(--muted);font-size:13px">mode: {review.mode} · risk: {review.riskTier}</span>
  </div>
</article>
