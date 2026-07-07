<script lang="ts">
  import type { Outcome } from '$lib/api';
  let { outcome }: { outcome: Outcome } = $props();

  function reviewCls(d: string): string {
    return d === 'approved' ? 'ok' : d === 'rejected' ? 'bad' : 'warn';
  }

  const stages = $derived.by(() => {
    const blocked = outcome.sanitization.blocked;
    const groundingBad = outcome.grounding.blockedExport;
    return [
      { key: 'Sanitize', cls: blocked ? 'bad' : 'ok' },
      { key: 'Ground', cls: blocked ? 'skip' : 'ok' },
      { key: 'Generate', cls: blocked ? 'skip' : outcome.output ? 'ok' : 'skip' },
      { key: 'Validate', cls: blocked ? 'skip' : groundingBad ? 'warn' : 'ok' },
      { key: 'Gate', cls: reviewCls(outcome.review.decision) },
    ];
  });
</script>

<ol class="stepper">
  {#each stages as st}
    <li class={st.cls}><span class="dot"></span>{st.key}</li>
  {/each}
</ol>
