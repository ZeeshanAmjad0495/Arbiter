<script lang="ts">
  let { output, model, label }: { output: unknown; model: string; label: string } = $props();

  function humanize(key: string): string {
    return key
      .replace(/_/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/^./, (c) => c.toUpperCase());
  }

  function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
  }

  function isPrimitive(v: unknown): boolean {
    return v === null || ['string', 'number', 'boolean'].includes(typeof v);
  }

  function columns(rows: Record<string, unknown>[]): string[] {
    const set = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) set.add(k);
    return [...set];
  }

  function chipClass(key: string, value: unknown): string {
    const v = String(value).toLowerCase();
    if (['high', 'critical', 'blocker', 'no_go', 'major'].includes(v)) return 'chip bad';
    if (['medium', 'go_with_risk', 'minor'].includes(v)) return 'chip warn';
    if (['low', 'go', 'trivial', 'true'].includes(v)) return 'chip good';
    return 'chip';
  }

  const BADGE_KEYS = ['severity', 'priority', 'recommendation', 'decision', 'category'];

  const entries = $derived(isObject(output) ? Object.entries(output) : []);
</script>

<article class="card">
  <h3>{label} <span class="tag muted">{model}</span></h3>
  {#if !output}
    <div style="color:var(--muted)">No artifact — the run short-circuited before generation.</div>
  {:else if !isObject(output)}
    <pre class="mono">{JSON.stringify(output, null, 2)}</pre>
  {:else}
    {#each entries as [key, value]}
      <div class="go-section">
        <h4>{humanize(key)}</h4>
        {#if Array.isArray(value)}
          {#if value.length === 0}
            <span class="muted-text">(none)</span>
          {:else if isObject(value[0])}
            <div class="go-table-wrap">
              <table class="go-table">
                <thead>
                  <tr>{#each columns(value as Record<string, unknown>[]) as col}<th>{humanize(col)}</th>{/each}</tr>
                </thead>
                <tbody>
                  {#each value as row}
                    <tr>
                      {#each columns(value as Record<string, unknown>[]) as col}
                        <td>
                          {#if BADGE_KEYS.includes(col)}
                            <span class={chipClass(col, (row as Record<string, unknown>)[col])}>
                              {String((row as Record<string, unknown>)[col] ?? '')}
                            </span>
                          {:else}
                            {String((row as Record<string, unknown>)[col] ?? '')}
                          {/if}
                        </td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <ul>{#each value as item}<li>{String(item)}</li>{/each}</ul>
          {/if}
        {:else if isObject(value)}
          <pre class="mono">{JSON.stringify(value, null, 2)}</pre>
        {:else if BADGE_KEYS.includes(key)}
          <span class={chipClass(key, value)}>{String(value)}</span>
        {:else if typeof value === 'boolean'}
          <span class="chip {value ? 'good' : ''}">{value ? 'yes' : 'no'}</span>
        {:else}
          <div class="go-value">{String(value)}</div>
        {/if}
      </div>
    {/each}
  {/if}
</article>

<style>
  .go-section {
    margin: 12px 0;
  }
  .go-section h4 {
    margin: 0 0 5px;
    font-size: 12px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .go-value {
    font-size: 14px;
  }
  .muted-text {
    color: var(--muted);
    font-size: 13px;
  }
  .go-table-wrap {
    overflow-x: auto;
  }
  .go-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  .go-table th,
  .go-table td {
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .go-table th {
    color: var(--muted);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  ul {
    margin: 0;
    padding-left: 20px;
  }
  li {
    margin: 2px 0;
  }
</style>
