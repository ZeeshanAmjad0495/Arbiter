<script lang="ts">
  /**
   * Renders an artifact's content as a readable document instead of raw JSON.
   *
   * Deliberately schema-agnostic: the 39 workflows each emit a different shape, so this
   * walks the value generically (humanised labels, bulleted lists, numbered cards for
   * arrays of objects) rather than hard-coding a renderer per workflow. Empty values are
   * dropped so a reviewer only sees what the model actually produced.
   */
  import Self from './DocView.svelte';

  interface Props {
    value: unknown;
    level?: number;
  }
  let { value, level = 0 }: Props = $props();

  const humanize = (k: string): string =>
    k
      .replace(/[_-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^./, (c) => c.toUpperCase());

  const isPrimitive = (v: unknown): boolean => v === null || typeof v !== 'object';
  const isEmpty = (v: unknown): boolean =>
    v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

  /** Short scalar-ish values render inline; long prose gets its own block. */
  const isLong = (v: unknown): boolean => typeof v === 'string' && v.length > 80;

  /**
   * Reading order, not key order. Raw JSON key order buries the point — e.g.
   * feature_flag_matrix listed `flags` and `notes` above its `summary`. Lead with the
   * headline, then verdicts/scores, then the detail lists.
   */
  const LEAD = /(title|summary|headline|objective|overview|verdict|recommendation|decision|posture|score)$/i;
  const ordered = $derived.by(() => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => !isEmpty(v));
    const rank = (k: string, v: unknown): number => (LEAD.test(k) ? 0 : isPrimitive(v) ? 1 : 2);
    return entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e[0], a.e[1]) - rank(b.e[0], b.e[1]) || a.i - b.i).map((x) => x.e);
  });
</script>

{#if value === null || value === undefined}
  <span class="muted">—</span>
{:else if typeof value === 'boolean'}
  <span class="pill">{value ? 'Yes' : 'No'}</span>
{:else if typeof value === 'number'}
  <span class="num">{value}</span>
{:else if typeof value === 'string'}
  <span class="text" class:prose={isLong(value)}>{value}</span>
{:else if Array.isArray(value)}
  {#if value.every(isPrimitive)}
    <ul class="bullets">
      {#each value as v}
        <li>{v}</li>
      {/each}
    </ul>
  {:else}
    <div class="cards">
      {#each value as v, i}
        <div class="item">
          <span class="idx">{i + 1}</span>
          <div class="item-body"><Self value={v} level={level + 1} /></div>
        </div>
      {/each}
    </div>
  {/if}
{:else}
  <dl class="fields">
    {#each ordered as [k, v]}
      <div class="field" class:stacked={!isPrimitive(v) || isLong(v)}>
        <dt>{humanize(k)}</dt>
        <dd><Self value={v} level={level + 1} /></dd>
      </div>
    {/each}
  </dl>
{/if}

<style>
  .fields {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .field {
    display: grid;
    grid-template-columns: minmax(120px, 180px) 1fr;
    gap: 12px;
    align-items: baseline;
  }
  .field.stacked {
    grid-template-columns: 1fr;
    gap: 4px;
  }
  dt {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  dd {
    margin: 0;
    min-width: 0;
    font-size: 13.5px;
    color: var(--ink);
  }
  .text {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .prose {
    display: block;
    line-height: 1.55;
  }
  .num {
    font-variant-numeric: tabular-nums;
  }
  .pill {
    display: inline-block;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--inset);
    border: 1px solid var(--line);
    font-size: 12px;
  }
  .bullets {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bullets li {
    font-size: 13.5px;
    line-height: 1.5;
  }
  .cards {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .item {
    display: grid;
    grid-template-columns: 22px 1fr;
    gap: 10px;
    padding: 10px 12px;
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 9px;
  }
  .idx {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    padding-top: 2px;
  }
  .item-body {
    min-width: 0;
  }
  .muted {
    color: var(--muted);
  }
</style>
