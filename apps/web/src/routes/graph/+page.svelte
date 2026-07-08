<script lang="ts">
  import { onMount } from 'svelte';
  import { buildGraph, getGraph, type GraphData, type GraphNodeDto } from '$lib/api';
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

  // --- viewBox space (nodes live here; the view transform maps it to the screen) ---
  const W = 900;
  const H = 560;
  const CX = W / 2;
  const CY = H / 2;
  const SHOW_CAP = 70; // biggest nodes drawn on the map; the full list stays below
  const EDGE_CAP = 220; // strongest connections drawn (a 70-node map has thousands — most are noise)

  const shown = $derived([...graph.nodes].sort((a, b) => b.mentions - a.mentions).slice(0, SHOW_CAP));
  const shownIds = $derived(new Set(shown.map((n) => n.id)));
  const shownEdgesAll = $derived(graph.edges.filter((e) => shownIds.has(e.source) && shownIds.has(e.target)));
  // Render only the strongest edges (plus, always, the selected node's own edges) to keep the map legible.
  const shownEdges = $derived.by(() => {
    const strong = [...shownEdgesAll].sort((a, b) => b.weight - a.weight).slice(0, EDGE_CAP);
    if (!selected) return strong;
    const seen = new Set(strong);
    const sel = shownEdgesAll.filter((e) => (e.source === selected || e.target === selected) && !seen.has(e));
    return [...strong, ...sel];
  });
  const rank = $derived(new Map(shown.map((n, i) => [n.id, i])));
  const byId = $derived(new Map(graph.nodes.map((n) => [n.id, n])));

  const byType = $derived(
    Object.entries(graph.nodes.reduce<Record<string, number>>((acc, n) => ((acc[n.type] = (acc[n.type] ?? 0) + 1), acc), {})).sort(
      (a, b) => b[1] - a[1],
    ),
  );

  // Neighbours across the WHOLE graph (so the detail panel is complete even for
  // connections that fall outside the drawn top-N), strongest edge first.
  interface Neighbor { id: string; label: string; type: string; weight: number }
  const neighbors = $derived.by(() => {
    const m = new Map<string, Neighbor[]>();
    const push = (from: string, n: Neighbor) => (m.get(from) ?? m.set(from, []).get(from)!).push(n);
    for (const e of graph.edges) {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) continue;
      push(a.id, { id: b.id, label: b.label, type: b.type, weight: e.weight });
      push(b.id, { id: a.id, label: a.label, type: a.type, weight: e.weight });
    }
    for (const arr of m.values()) arr.sort((x, y) => y.weight - x.weight);
    return m;
  });

  const nodeR = (mentions: number) => Math.min(16, 6 + Math.sqrt(mentions) * 2);

  // --- layout + view state ---
  let positions = $state<Record<string, { x: number; y: number }>>({});
  let view = $state({ x: 0, y: 0, k: 1 });
  let selected = $state<string | null>(null);
  let hovered = $state<string | null>(null);
  let svgEl: SVGSVGElement | undefined = $state();

  const selectedNode = $derived(selected ? (byId.get(selected) ?? null) : null);
  const selectedNeighbors = $derived(selected ? (neighbors.get(selected) ?? []) : []);
  const neighborIds = $derived(new Set(selectedNeighbors.map((n) => n.id)));

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  /**
   * Deterministic Fruchterman-Reingold layout with hard collision, computed once per graph.
   * Attraction runs over the strongest edges only, so a densely co-occurring top-N set spreads
   * into readable clusters instead of collapsing into one blob.
   */
  function computeLayout(ns: GraphNodeDto[], es: GraphData['edges']): Record<string, { x: number; y: number }> {
    const N = ns.length;
    if (N === 0) return {};
    if (N === 1) return { [ns[0]!.id]: { x: CX, y: CY } };
    const idx = new Map(ns.map((n, i) => [n.id, i]));
    const radii = ns.map((n) => nodeR(n.mentions));
    const px = new Float64Array(N);
    const py = new Float64Array(N);
    const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle → even, deterministic seed spiral
    for (let i = 0; i < N; i++) {
      const r = 20 + 300 * Math.sqrt((i + 1) / N);
      px[i] = CX + r * Math.cos(i * GA);
      py[i] = CY + r * Math.sin(i * GA);
    }
    // Attract along the strongest edges only (≈4 per node); weak co-occurrence is layout noise.
    const eIdx = [...es]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, N * 4)
      .map((e) => [idx.get(e.source), idx.get(e.target), e.weight] as const)
      .filter((e): e is [number, number, number] => e[0] !== undefined && e[1] !== undefined && e[0] !== e[1]);

    const k = Math.sqrt((W * 0.82 * (H * 0.82)) / N) * 0.8; // ideal edge length
    const ITER = 320;
    let temp = W * 0.07;
    for (let it = 0; it < ITER; it++) {
      const fx = new Float64Array(N);
      const fy = new Float64Array(N);
      // Repulsion (all pairs) + hard collision when circles overlap.
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          let dx = px[i]! - px[j]!;
          let dy = py[i]! - py[j]!;
          let d = Math.hypot(dx, dy) || 0.01;
          const ux = dx / d;
          const uy = dy / d;
          let f = (k * k) / d;
          const minD = radii[i]! + radii[j]! + 10;
          if (d < minD) f += (minD - d) * 3;
          fx[i]! += ux * f;
          fy[i]! += uy * f;
          fx[j]! -= ux * f;
          fy[j]! -= uy * f;
        }
      }
      // Attraction along strong edges (damped so dense hubs don't collapse).
      for (const [a, b, w] of eIdx) {
        const dx = px[a]! - px[b]!;
        const dy = py[a]! - py[b]!;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = ((d * d) / k) * Math.min(1 + Math.log2(1 + w), 3) * 0.11;
        const ux = dx / d;
        const uy = dy / d;
        fx[a]! -= ux * f;
        fy[a]! -= uy * f;
        fx[b]! += ux * f;
        fy[b]! += uy * f;
      }
      // Integrate, limited by the cooling temperature, then clamp inside the frame
      // so the layout can never spread past the viewBox (keeps it centred + framed).
      for (let i = 0; i < N; i++) {
        fx[i]! += (CX - px[i]!) * 0.02;
        fy[i]! += (CY - py[i]!) * 0.02;
        const disp = Math.hypot(fx[i]!, fy[i]!) || 1;
        const lim = Math.min(disp, temp);
        px[i]! = clamp(px[i]! + (fx[i]! / disp) * lim, W * 0.06, W * 0.94);
        py[i]! = clamp(py[i]! + (fy[i]! / disp) * lim, H * 0.06, H * 0.94);
      }
      temp *= 0.985;
    }
    const out: Record<string, { x: number; y: number }> = {};
    ns.forEach((n, i) => (out[n.id] = { x: px[i]!, y: py[i]! }));
    return out;
  }

  /** Fit the given layout into the viewBox (called with a local map — never reads the `positions` signal). */
  function fitView(ps: Record<string, { x: number; y: number }>) {
    const vals = Object.values(ps);
    if (vals.length === 0) return (view = { x: 0, y: 0, k: 1 });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of vals) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 70;
    const bw = maxX - minX || 1;
    const bh = maxY - minY || 1;
    const k = clamp(Math.min((W - 2 * pad) / bw, (H - 2 * pad) / bh), 0.25, 2.2);
    view = { k, x: W / 2 - ((minX + maxX) / 2) * k, y: H / 2 - ((minY + maxY) / 2) * k };
  }

  // Recompute layout only when the graph (drawn set) changes — NOT on drag/zoom/select.
  $effect(() => {
    const ns = shown;
    const es = shownEdgesAll;
    if (ns.length === 0) {
      positions = {};
      return;
    }
    const out = computeLayout(ns, es);
    positions = out;
    fitView(out);
    if (selected && !out[selected]) selected = null;
  });

  // --- screen ⇄ viewBox coordinate mapping (accounts for xMidYMid "meet" letterboxing) ---
  function fitMetrics() {
    const r = svgEl!.getBoundingClientRect();
    const scale = Math.min(r.width / W, r.height / H);
    return { r, scale, offX: (r.width - W * scale) / 2, offY: (r.height - H * scale) / 2 };
  }
  function toViewBox(clientX: number, clientY: number) {
    const { r, scale, offX, offY } = fitMetrics();
    return { sx: (clientX - r.left - offX) / scale, sy: (clientY - r.top - offY) / scale };
  }

  // --- pointer interaction (pan on background, drag a node, click to select) ---
  let drag = $state<{ kind: 'pan' | 'node'; id?: string; lastX: number; lastY: number; moved: number } | null>(null);

  function onPointerDown(ev: PointerEvent, id?: string) {
    if (ev.button !== 0) return;
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
    drag = { kind: id ? 'node' : 'pan', id, lastX: ev.clientX, lastY: ev.clientY, moved: 0 };
    if (id) ev.stopPropagation();
  }

  function onPointerMove(ev: PointerEvent) {
    if (!drag) {
      return;
    }
    const dx = ev.clientX - drag.lastX;
    const dy = ev.clientY - drag.lastY;
    drag.lastX = ev.clientX;
    drag.lastY = ev.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.kind === 'pan') {
      const { scale } = fitMetrics();
      view = { ...view, x: view.x + dx / scale, y: view.y + dy / scale };
    } else if (drag.id) {
      const { sx, sy } = toViewBox(ev.clientX, ev.clientY);
      positions = { ...positions, [drag.id]: { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k } };
    }
  }

  function onPointerUp() {
    if (drag?.kind === 'node' && drag.id && drag.moved < 5) selected = selected === drag.id ? null : drag.id;
    drag = null;
  }

  function zoomAt(sx: number, sy: number, factor: number) {
    const k = clamp(view.k * factor, 0.2, 6);
    const gx = (sx - view.x) / view.k;
    const gy = (sy - view.y) / view.k;
    view = { k, x: sx - gx * k, y: sy - gy * k };
  }

  function onWheel(ev: WheelEvent) {
    ev.preventDefault();
    const { sx, sy } = toViewBox(ev.clientX, ev.clientY);
    zoomAt(sx, sy, Math.exp(-ev.deltaY * 0.0015));
  }

  function selectFromList(id: string) {
    selected = selected === id ? null : id;
    // If it's on the map, nudge the view to centre it.
    const p = positions[id];
    if (p) view = { ...view, x: W / 2 - p.x * view.k, y: H / 2 - p.y * view.k };
  }

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
      selected = null;
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
      <h2>Concept Map</h2>
      <p class="sub">
        The key terms in your reference docs and how they connect. Drag to move around, scroll to zoom, and click any term to see
        everything it links to. Turn on “Use concept map” when creating a document to pull in related terms automatically.
      </p>
    </div>
    <button class="primary" style="width:auto" disabled={building} onclick={rebuild}>
      <Icon name="refresh" size={15} /> {building ? 'Building…' : graph.nodes.length ? 'Rebuild map' : 'Build map'}
    </button>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  {#if graph.nodes.length === 0}
    <div class="empty">
      <p>No concept map yet.</p>
      <p style="font-size:13px">Add documents in <a href="/knowledge">Reference Docs</a>, then build the map to pull out the key terms and how they connect.</p>
    </div>
  {:else}
    <div class="stats">
      <div class="stat"><span class="label">Terms</span><b>{graph.nodes.length}</b></div>
      <div class="stat"><span class="label">Connections</span><b>{graph.edges.length}</b></div>
      <div class="stat"><span class="label">Categories</span><b>{byType.length}</b></div>
    </div>

    <div class="viz card">
      <div class="toolbar">
        <button class="tool" aria-label="Zoom in" onclick={() => zoomAt(CX, CY, 1.25)}><Icon name="plus" size={16} /></button>
        <button class="tool" aria-label="Zoom out" onclick={() => zoomAt(CX, CY, 0.8)}><span class="minus" aria-hidden="true"></span></button>
        <button class="tool" aria-label="Reset view" onclick={() => fitView(positions)}><Icon name="refresh" size={15} /></button>
        <span class="hint">{Math.round(view.k * 100)}%</span>
      </div>

      <svg
        bind:this={svgEl}
        viewBox="0 0 {W} {H}"
        role="group"
        aria-label="Interactive concept map. Drag to pan, scroll to zoom, click a term for details."
        class="canvas"
        class:grabbing={drag?.kind === 'pan'}
        onpointerdown={(e) => onPointerDown(e)}
        onpointermove={onPointerMove}
        onpointerup={onPointerUp}
        onpointerleave={onPointerUp}
        onwheel={onWheel}
      >
        <g transform="translate({view.x} {view.y}) scale({view.k})">
          {#each shownEdges as e}
            {@const a = positions[e.source]}
            {@const b = positions[e.target]}
            {#if a && b}
              {@const active = !selected || e.source === selected || e.target === selected}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={active && selected ? color(byId.get(selected)?.type ?? 'term') : 'var(--line-strong)'}
                stroke-width={Math.min(3, 0.5 + e.weight * 0.4) / view.k}
                opacity={active ? 0.55 : 0.08}
              />
            {/if}
          {/each}
          {#each shown as n (n.id)}
            {@const p = positions[n.id]}
            {#if p}
              {@const isSel = selected === n.id}
              {@const isNbr = neighborIds.has(n.id)}
              {@const dim = selected && !isSel && !isNbr}
              {@const showLabel = isSel || isNbr || hovered === n.id || (!selected && (rank.get(n.id) ?? 99) < 26)}
              <g
                class="node"
                class:dim
                role="button"
                tabindex="0"
                aria-label={`${n.label}, ${n.type}, ${n.mentions} mention${n.mentions === 1 ? '' : 's'}. Press Enter for details.`}
                aria-pressed={isSel}
                onpointerdown={(e) => onPointerDown(e, n.id)}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectFromList(n.id);
                  }
                }}
                onmouseenter={() => (hovered = n.id)}
                onmouseleave={() => (hovered = null)}
              >
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={(nodeR(n.mentions) + (isSel ? 3 : 0)) / view.k}
                  fill={color(n.type)}
                  stroke={isSel ? 'var(--ink)' : 'var(--surface)'}
                  stroke-width={(isSel ? 2.5 : 1.5) / view.k}
                />
                {#if showLabel}
                  <text
                    x={p.x}
                    y={p.y - (nodeR(n.mentions) + 5) / view.k}
                    text-anchor="middle"
                    font-size={11 / view.k}
                    fill="var(--ink)"
                    style="pointer-events:none">{n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label}</text
                  >
                {/if}
              </g>
            {/if}
          {/each}
        </g>
      </svg>

      {#if selectedNode}
        <aside class="detail" aria-live="polite">
          <div class="detail-head">
            <span class="type-badge" style="background:{color(selectedNode.type)}">{selectedNode.type}</span>
            <button class="close" aria-label="Close details" onclick={() => (selected = null)}><Icon name="close" size={15} /></button>
          </div>
          <h3 title={selectedNode.label}>{selectedNode.label}</h3>
          <div class="meta">
            <span><b>{selectedNode.mentions}</b> mention{selectedNode.mentions === 1 ? '' : 's'}</span>
            <span><b>{selectedNeighbors.length}</b> connection{selectedNeighbors.length === 1 ? '' : 's'}</span>
          </div>
          {#if selectedNeighbors.length}
            <div class="nbr-label">Connected to</div>
            <ul class="nbrs">
              {#each selectedNeighbors.slice(0, 40) as nb}
                <li>
                  <button class="nbr" onclick={() => selectFromList(nb.id)}>
                    <span class="sw" style="background:{color(nb.type)}"></span>
                    <span class="nbr-name" title={nb.label}>{nb.label}</span>
                    <span class="nbr-w" title="co-occurrence strength">×{nb.weight}</span>
                  </button>
                </li>
              {/each}
            </ul>
            {#if selectedNeighbors.length > 40}<p class="muted small">+{selectedNeighbors.length - 40} more</p>{/if}
          {:else}
            <p class="muted small">No connections found for this term.</p>
          {/if}
        </aside>
      {/if}

      <div class="legend">
        {#each byType as [t]}
          <span class="lg"><span class="sw" style="background:{color(t)}"></span>{t}</span>
        {/each}
        {#if graph.nodes.length > shown.length}<span class="muted">drawing top {shown.length} of {graph.nodes.length}</span>{/if}
      </div>
    </div>

    <div class="card">
      <h3>Entities by type</h3>
      <p class="muted small">Select any term to highlight it on the map and see its connections.</p>
      {#each byType as [type]}
        <div class="type-block">
          <div class="type-head"><span class="sw" style="background:{color(type)}"></span>{type}</div>
          <div class="chips">
            {#each graph.nodes.filter((n) => n.type === type).sort((a, b) => b.mentions - a.mentions) as n}
              <button class="chip" class:active={selected === n.id} title="{n.mentions} mention(s)" onclick={() => selectFromList(n.id)}>{n.label}</button>
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
    max-width: 640px;
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
    position: relative;
    margin-bottom: 14px;
  }
  .toolbar {
    position: absolute;
    top: 14px;
    left: 14px;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .tool {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 8px;
    cursor: pointer;
    color: var(--ink);
  }
  .tool:hover {
    background: var(--inset);
  }
  .minus {
    width: 12px;
    height: 2px;
    background: currentColor;
    display: inline-block;
    border-radius: 2px;
  }
  .hint {
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    margin-left: 2px;
  }
  .canvas {
    width: 100%;
    height: 540px;
    display: block;
    touch-action: none;
    cursor: grab;
    background: var(--inset);
    border-radius: 10px;
  }
  .canvas.grabbing {
    cursor: grabbing;
  }
  .node {
    cursor: pointer;
    outline: none;
  }
  .node.dim {
    opacity: 0.25;
  }
  .node:focus-visible circle {
    stroke: var(--accent, #4f46e5);
    stroke-width: 3;
  }
  .detail {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 2;
    width: 260px;
    max-height: calc(100% - 28px);
    overflow-y: auto;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  }
  .detail-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .type-badge {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #fff;
    padding: 3px 8px;
    border-radius: 999px;
    font-weight: 600;
  }
  .close {
    border: none;
    background: none;
    cursor: pointer;
    color: var(--muted);
    display: inline-flex;
    padding: 2px;
    border-radius: 6px;
  }
  .close:hover {
    background: var(--inset);
    color: var(--ink);
  }
  .detail h3 {
    margin: 0 0 8px;
    font-size: 15px;
    word-break: break-word;
  }
  .meta {
    display: flex;
    gap: 14px;
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 12px;
  }
  .nbr-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--muted);
    margin-bottom: 6px;
  }
  .nbrs {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .nbr {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: none;
    border: none;
    padding: 5px 6px;
    border-radius: 7px;
    cursor: pointer;
    font-size: 12.5px;
    color: var(--ink);
    text-align: left;
  }
  .nbr:hover {
    background: var(--inset);
  }
  .nbr-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nbr-w {
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin-top: 10px;
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
    flex: none;
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
  .chip {
    border: 1px solid var(--line);
    background: var(--surface);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 12px;
    color: var(--ink);
    cursor: pointer;
  }
  .chip:hover {
    background: var(--inset);
  }
  .chip.active {
    border-color: var(--accent, #4f46e5);
    background: color-mix(in srgb, var(--accent, #4f46e5) 12%, transparent);
  }
  .muted {
    color: var(--muted);
  }
  .small {
    font-size: 12px;
  }
</style>
