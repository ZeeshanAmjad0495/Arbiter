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
  import Modal from '$lib/components/Modal.svelte';

  let { children } = $props();
  let status = $state<StatusInfo | null>(null);
  let theme = $state<'light' | 'dark'>('light');
  let projects = $state<ProjectInfo[]>([]);
  let selectedProjectId = $state<string>('');
  let showCreate = $state(false);
  let newName = $state('');
  let creating = $state(false);
  let projMenuOpen = $state(false);
  let statusOpen = $state(false);
  let sidebarOpen = $state(false);

  const NAV = [
    {
      group: 'Workspace',
      items: [
        { href: '/', label: 'Workbench', ico: '⚗️' },
        { href: '/review', label: 'Review Queue', ico: '✅' },
      ],
    },
    {
      group: 'Project data',
      items: [{ href: '/knowledge', label: 'Knowledge', ico: '📚' }],
    },
    {
      group: 'Insights',
      items: [
        { href: '/insights', label: 'Insights', ico: '📈' },
        { href: '/prompts', label: 'Prompt Library', ico: '🧩' },
      ],
    },
  ];

  const STATUS_LABELS: Record<string, string> = {
    persistence: 'Storage',
    sanitizer: 'PII sanitizer',
    llm: 'Model provider',
    telemetry: 'Tracing',
    demask: 'De-mask store',
  };
  const liveModes = new Set(['postgres', 'presidio', 'anthropic', 'kimi', 'litellm', 'otlp', 'encrypted']);

  const activePath = $derived($page.url.pathname);
  const pageTitle = $derived(
    activePath === '/'
      ? 'Workbench'
      : (NAV.flatMap((g) => g.items).find((i) => i.href !== '/' && activePath.startsWith(i.href))?.label ?? 'Workbench'),
  );
  const currentProject = $derived(projects.find((p) => p.id === selectedProjectId));

  function isActive(href: string): boolean {
    return href === '/' ? activePath === '/' : activePath.startsWith(href);
  }

  async function loadProjects() {
    const { defaultProjectId, projects: list } = await listProjects();
    projects = list;
    const stored = getActiveProject();
    const valid = stored && list.some((p) => p.id === stored) ? stored : null;
    setActiveProject(valid);
    selectedProjectId = valid ?? defaultProjectId;
  }

  function switchProject(id: string) {
    projMenuOpen = false;
    if (id === selectedProjectId) return;
    setActiveProject(id);
    location.reload();
  }

  async function submitCreate() {
    if (!newName.trim()) return;
    creating = true;
    try {
      const project = await createProject({ name: newName.trim() });
      newName = '';
      showCreate = false;
      setActiveProject(project.id);
      location.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to create project');
    } finally {
      creating = false;
    }
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('arbiter-theme', theme);
  }

  onMount(async () => {
    const saved = localStorage.getItem('arbiter-theme') as 'light' | 'dark' | null;
    theme = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
    try {
      await loadProjects();
    } catch {
      /* API-only / offline */
    }
    try {
      status = await getStatus();
    } catch {
      status = null;
    }
  });
</script>

<a class="skip-link" href="#main-content">Skip to main content</a>

<div class="app-shell">
  <aside class="sidebar" class:open={sidebarOpen}>
    <div class="brand">
      <span class="brand-mark">⚖️</span>
      <div>
        <h1>Arbiter</h1>
        <p class="tagline">AI drafts, QA owns judgment</p>
      </div>
    </div>

    {#each NAV as grp}
      <div class="nav-group-label">{grp.group}</div>
      {#each grp.items as item}
        <a
          href={item.href}
          class="nav-item"
          class:active={isActive(item.href)}
          onclick={() => (sidebarOpen = false)}
        >
          <span class="ico" aria-hidden="true">{item.ico}</span>
          {item.label}
        </a>
      {/each}
    {/each}
  </aside>

  <div>
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="iconbtn menu-toggle" aria-label="Toggle menu" onclick={() => (sidebarOpen = !sidebarOpen)}>☰</button>
        <span class="page-title">{pageTitle}</span>
      </div>

      <div class="topbar-right">
        {#if projects.length > 0}
          <div style="position:relative">
            <button class="proj-switch" onclick={() => (projMenuOpen = !projMenuOpen)} aria-haspopup="menu" aria-expanded={projMenuOpen}>
              <span class="dot"></span>
              {currentProject?.name ?? 'Project'}
              <span aria-hidden="true" style="opacity:.6">▾</span>
            </button>
            {#if projMenuOpen}
              <button class="menu-scrim" aria-label="Close menu" onclick={() => (projMenuOpen = false)}></button>
              <div class="dropdown" role="menu">
                <div class="dd-label">Switch project</div>
                {#each projects as p}
                  <button class="dd-item" class:sel={p.id === selectedProjectId} role="menuitem" onclick={() => switchProject(p.id)}>
                    <span class="dot"></span>{p.name}
                  </button>
                {/each}
                <div class="dd-sep"></div>
                <button class="dd-item accent" role="menuitem" onclick={() => { projMenuOpen = false; showCreate = true; }}>＋ New project</button>
              </div>
            {/if}
          </div>
        {/if}

        {#if status}
          <div class="status-pop">
            <button class="iconbtn" aria-label="System status" title="System status" onclick={() => (statusOpen = !statusOpen)}>◍</button>
            {#if statusOpen}
              <button class="menu-scrim" aria-label="Close status" onclick={() => (statusOpen = false)}></button>
              <div class="status-menu">
                <h4>System status · green = live service</h4>
                {#each Object.entries(status.modes) as [key, value]}
                  <div class="status-row">
                    <span class="lbl">{STATUS_LABELS[key] ?? key}</span>
                    <span class="status-val" class:live={liveModes.has(value)}>{value}</span>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}

        <button class="iconbtn" aria-label="Toggle theme" onclick={toggleTheme}>◐</button>
      </div>
    </header>

    <main id="main-content" tabindex="-1" class="content">
      {@render children()}
    </main>
  </div>
</div>

{#if showCreate}
  <Modal title="New project" subtitle="Projects isolate runs, review queue, knowledge, and metrics." onclose={() => (showCreate = false)}>
    <label class="field">
      <span>Project name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="text" placeholder="e.g. Checkout revamp" bind:value={newName} autofocus onkeydown={(e) => e.key === 'Enter' && submitCreate()} />
    </label>
    <div class="modal-actions">
      <button class="ghost" onclick={() => (showCreate = false)}>Cancel</button>
      <button class="primary" style="width:auto" disabled={creating || !newName.trim()} onclick={submitCreate}>
        {creating ? 'Creating…' : 'Create project'}
      </button>
    </div>
  </Modal>
{/if}

<style>
  .menu-scrim {
    position: fixed;
    inset: 0;
    background: transparent;
    border: none;
    z-index: 18;
    cursor: default;
  }
  .dropdown {
    position: absolute;
    right: 0;
    top: 42px;
    width: 240px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 12px;
    box-shadow: 0 12px 32px var(--shadow-lg);
    padding: 6px;
    z-index: 20;
  }
  .dd-label {
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--muted);
    padding: 6px 8px;
  }
  .dd-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    color: var(--ink);
    cursor: pointer;
  }
  .dd-item:hover {
    background: var(--inset);
  }
  .dd-item.sel {
    color: var(--accent-strong);
    font-weight: 650;
  }
  .dd-item.accent {
    color: var(--accent-strong);
    font-weight: 600;
  }
  .dd-item .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    flex: none;
  }
  .dd-sep {
    height: 1px;
    background: var(--line);
    margin: 6px 4px;
  }
  .skip-link {
    position: absolute;
    left: -9999px;
    top: 0;
    z-index: 100;
    background: var(--accent-strong);
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
</style>
