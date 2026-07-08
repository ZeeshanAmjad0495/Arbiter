<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = '',
    onclose,
    children,
  }: { title: string; subtitle?: string; onclose: () => void; children: Snippet } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
  }
</script>

<svelte:window on:keydown={onkeydown} />

<div
  class="modal-backdrop"
  role="button"
  tabindex="-1"
  aria-label="Close dialog"
  onclick={(e) => {
    if (e.target === e.currentTarget) onclose();
  }}
  onkeydown={() => {}}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <h3>{title}</h3>
    {#if subtitle}<p class="sub">{subtitle}</p>{/if}
    {@render children()}
  </div>
</div>
