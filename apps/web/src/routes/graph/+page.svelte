<script lang="ts">
  import { onMount } from 'svelte';
  import { buildGraph, getGraph, type GraphData } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let graph = $state<GraphData>({ nodes: [], edges: [] });
  let building = $state(false);
  let error = $state<string | null>(null);

  const TYPE_COLORS: Record<string, string> = {
    field: '#4f46e5',
    endpoint: '#067647',
    requirement: '#b54708',
    test: '#0e7490',
    control: '#b42318',
    term: '#667085',
  };
  const color = (t: string) => TYPE_COLORS[t] ?? '#667085';

  const W = 640;
  const H = 480;
  const shown = $derived([...graph.nodes].sort((a, b) => b.mentions - a.mentions).slice(0, 44));
  const shownIds = $derived(new Set(shown.map((n) => n.id)));
  const pos = $derived(
    new Map(
      shown.map((n, i) => {
        const ang = (i / Math.max(1, shown.length)) * 2 * Math.PI - Math.PI / 2;
        return [n.id, { x: W / 2 + (W / 2 - 70) * Math.cos(ang), y: H / 2 + (H / 2 - 50) * Math.sin(ang) }] as const;
      }),
    ),
  );
  const shownEdges = $derived(graph.edges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target)));
  const nodeR = (mentions: number) => Math.min(11, 5 + mentions);
  const byType = $derived(
    Object.entries(
      graph.nodes.reduce<Record<string, number>>((acc, n) => ((acc[n.type] = (acc[n.type] ?? 0) + 1), acc), {}),
    ).sort((a, b) => b[1] - a[1]),
  );

  async function load() {
    error = null;
    try {
      graph = await getGraph();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load graph';
    }
  }
  async function rebuild() {
    building = true;
    error = null;
    try {
      await buildGraph();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to build';
    } finally {
      building = false;
    }
  }

  onMount(load);
</script>

<section class="wrap">
  <div class="head">
    <div>
      <h2>Knowledge Graph</h2>
      <p class="sub">Entities and relationships extracted from this project's knowledge. GraphRAG expands connected entities into a run's context when "Use graph" is on.</p>
    </div>
    <button class="primary" style="width:auto" disabled={building} onclick={rebuild}>
      <Icon name="refresh" size={15} /> {building ? 'Building…' : graph.nodes.length ? 'Rebuild graph' : 'Build graph'}
    </button>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if graph.nodes.length === 0}
    <div class="empty">
      <p>No graph yet.</p>
      <p style="font-size:13px">Add documents in <a href="/knowledge">Knowledge</a>, then build the graph to extract entities and relationships.</p>
    </div>
  {:else}
    <div class="stats">
      <div class="stat"><span class="label">Entities</span><b>{graph.nodes.length}</b></div>
      <div class="stat"><span class="label">Relationships</span><b>{graph.edges.length}</b></div>
      <div class="stat"><span class="label">Types</span><b>{byType.length}</b></div>
    </div>

    <div class="viz card">
      <svg viewBox="0 0 {W} {H}" role="img" aria-label="Knowledge graph visualization" style="width:100%;height:auto">
        {#each shownEdges as e}
          {@const a = pos.get(e.source)}
          {@const b = pos.get(e.target)}
          {#if a && b}
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-strong)" stroke-width={Math.min(2.5, 0.5 + e.weight * 0.4)} opacity="0.5" />
          {/if}
        {/each}
        {#each shown as n}
          {@const p = pos.get(n.id)}
          {#if p}
            <g>
              <circle cx={p.x} cy={p.y} r={nodeR(n.mentions)} fill={color(n.type)} stroke="var(--surface)" stroke-width="1.5" />
              <text x={p.x} y={p.y - nodeR(n.mentions) - 4} text-anchor="middle" font-size="10" fill="var(--ink)">{n.label.length > 18 ? n.label.slice(0, 17) + '…' : n.label}</text>
            </g>
          {/if}
        {/each}
      </svg>
      <div class="legend">
        {#each byType as [t]}
          <span class="lg"><span class="sw" style="background:{color(t)}"></span>{t}</span>
        {/each}
        {#if graph.nodes.length > shown.length}<span class="muted">showing top {shown.length} of {graph.nodes.length}</span>{/if}
      </div>
    </div>

    <div class="card">
      <h3>Entities by type</h3>
      {#each byType as [type]}
        <div class="type-block">
          <div class="type-head"><span class="sw" style="background:{color(type)}"></span>{type}</div>
          <div class="chips">
            {#each graph.nodes.filter((n) => n.type === type).sort((a, b) => b.mentions - a.mentions) as n}
              <span class="chip" title="{n.mentions} mention(s)">{n.label}</span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</section>

<style>
  .wrap {
    max-width: 980px;
    margin: 0 auto;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 18px;
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    margin: 4px 0 0;
    max-width: 620px;
  }
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 12px;
    margin-bottom: 14px;
  }
  .stat {
    background: var(--inset);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .stat b {
    font-size: 22px;
  }
  .label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .viz {
    margin-bottom: 14px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }
  .lg {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    text-transform: capitalize;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    display: inline-block;
  }
  .type-block {
    margin: 10px 0;
  }
  .type-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    text-transform: capitalize;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .muted {
    color: var(--muted);
  }
</style>
