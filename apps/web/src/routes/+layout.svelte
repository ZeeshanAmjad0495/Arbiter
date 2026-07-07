<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    createProject,
    getActiveProject,
    getStatus,
    listProjects,
    setActiveProject,
    type ProjectInfo,
    type StatusInfo,
  } from '$lib/api';

  let { children } = $props();
  let status = $state<StatusInfo | null>(null);
  let theme = $state<'light' | 'dark'>('light');
  let projects = $state<ProjectInfo[]>([]);
  let selectedProjectId = $state<string>('');
  let creating = $state(false);

  async function loadProjects() {
    const { defaultProjectId, projects: list } = await listProjects();
    projects = list;
    const stored = getActiveProject();
    // Drop a stale/deleted selection so it falls back to the default project.
    const valid = stored && list.some((p) => p.id === stored) ? stored : null;
    setActiveProject(valid);
    selectedProjectId = valid ?? defaultProjectId;
  }

  function switchProject(id: string) {
    setActiveProject(id);
    // Full reload so every page (workbench, review queue) refetches under the
    // newly-selected project — the simplest correct cross-page refresh.
    location.reload();
  }

  async function createNew() {
    const name = window.prompt('New project name')?.trim();
    if (!name) return;
    creating = true;
    try {
      const project = await createProject({ name });
      switchProject(project.id);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      creating = false;
    }
  }

  onMount(async () => {
    const saved = localStorage.getItem('arbiter-theme') as 'light' | 'dark' | null;
    theme = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    try {
      await loadProjects();
    } catch {
      /* projects endpoint unreachable — API-only/offline; leave switcher empty */
    }
    try {
      status = await getStatus();
    } catch {
      status = null;
    }
  });

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('arbiter-theme', theme);
  }

  const liveModes = new Set(['postgres', 'presidio', 'anthropic', 'kimi', 'otlp', 'encrypted']);
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>

<header class="topbar">
  <div class="brand">
    <span class="brand-mark">⚖️</span>
    <div>
      <h1>Arbiter</h1>
      <p class="tagline">AI drafts, QA owns judgment</p>
    </div>
  </div>
  <nav class="mainnav">
    <a href="/" class:active={$page.url.pathname === '/'}>Workbench</a>
    <a href="/review" class:active={$page.url.pathname.startsWith('/review')}>Review Queue</a>
    <a href="/knowledge" class:active={$page.url.pathname.startsWith('/knowledge')}>Knowledge</a>
    <a href="/insights" class:active={$page.url.pathname.startsWith('/insights')}>Insights</a>
    <a href="/prompts" class:active={$page.url.pathname.startsWith('/prompts')}>Prompts</a>
  </nav>
  <div class="topbar-right">
    {#if projects.length > 0}
      <div class="project-switcher" title="Active project — all runs, reviews and data are scoped to it">
        <span class="proj-label">Project</span>
        <select
          aria-label="Active project"
          value={selectedProjectId}
          onchange={(e) => switchProject((e.currentTarget as HTMLSelectElement).value)}
        >
          {#each projects as p}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
        <button class="ghost" type="button" onclick={createNew} disabled={creating} title="Create a new project">+</button>
      </div>
    {/if}
    {#if status}
      <div class="modes" title="Active runtime modes — green = real service, grey = offline default">
        {#each Object.entries(status.modes) as [key, value]}
          <span class="mode-pill" class:live={liveModes.has(value)}>{key}: <b>{value}</b></span>
        {/each}
      </div>
    {/if}
    <button class="ghost" type="button" aria-label="Toggle theme" onclick={toggleTheme}>◐</button>
  </div>
</header>

<div id="main-content" tabindex="-1">
  {@render children()}
</div>

<style>
  .skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: 100;
    background: var(--accent-strong, #2563eb);
    color: #fff;
    padding: 8px 14px;
    border-radius: 0 0 8px 0;
    font-weight: 600;
  }
  .skip-link:focus {
    left: 0;
  }
  #main-content:focus {
    outline: none;
  }
  .mainnav {
    display: flex;
    gap: 4px;
    margin-left: 12px;
  }
  .mainnav a {
    text-decoration: none;
    color: var(--muted);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: 8px;
  }
  .mainnav a:hover {
    color: var(--ink);
    background: var(--inset);
  }
  .mainnav a.active {
    color: var(--accent-strong);
    background: var(--accent-soft);
  }
  .project-switcher {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .project-switcher .proj-label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .project-switcher select {
    font-size: 13px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--inset);
    color: var(--ink);
  }
</style>
