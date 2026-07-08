<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import {
    createProject,
    getActiveProject,
    getMe,
    getStatus,
    listProjects,
    logout,
    setActiveProject,
    type AuthUser,
    type ProjectInfo,
    type StatusInfo,
  } from '$lib/api';
  import Modal from '$lib/components/Modal.svelte';
  import Icon from '$lib/components/Icon.svelte';
  import Login from '$lib/components/Login.svelte';
  import { CATEGORIES } from '$lib/catalog';

  let { children } = $props();
  let status = $state<StatusInfo | null>(null);
  let theme = $state<'light' | 'dark'>('light');
  let projects = $state<ProjectInfo[]>([]);
  let selectedProjectId = $state<string>('');
  let showCreate = $state(false);
  let newName = $state('');
  let newClassification = $state('internal');
  let newDescription = $state('');
  let newRepoUrl = $state('');
  let newRepoPath = $state('');
  let newContext = $state('');
  let newSchemas = $state<{ name: string; schema: string }[]>([]);
  let creating = $state(false);
  let createError = $state('');
  let projMenuOpen = $state(false);
  let statusOpen = $state(false);
  let sidebarOpen = $state(false);
  let userMenuOpen = $state(false);

  // Auth gate
  let authReady = $state(false);
  let needLogin = $state(false);
  let currentUser = $state<AuthUser | null>(null);

  interface NavItem {
    href: string;
    label: string;
    ico: string;
    cat?: string;
  }
  const NAV: { group: string; items: NavItem[] }[] = [
    {
      group: 'Workbench',
      items: CATEGORIES.map((c) => ({ href: `/?cat=${c.key}`, label: c.label, ico: c.key, cat: c.key })),
    },
    {
      group: 'Workspace',
      items: [
        { href: '/review', label: 'Review Queue', ico: 'review' },
        { href: '/knowledge', label: 'Knowledge', ico: 'knowledge' },
        { href: '/graph', label: 'Knowledge Graph', ico: 'graph' },
        { href: '/validate', label: 'Schema Validator', ico: 'validate' },
      ],
    },
    {
      group: 'Insights',
      items: [
        { href: '/insights', label: 'Insights', ico: 'insights' },
        { href: '/prompts', label: 'Prompt Library', ico: 'prompts' },
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
  const currentCat = $derived($page.url.searchParams.get('cat') ?? 'author');
  const pageTitle = $derived(
    activePath === '/'
      ? (CATEGORIES.find((c) => c.key === currentCat)?.label ?? 'Workbench')
      : (NAV.flatMap((g) => g.items).find((i) => !i.cat && i.href !== '/' && activePath.startsWith(i.href))?.label ?? 'Arbiter'),
  );
  const currentProject = $derived(projects.find((p) => p.id === selectedProjectId));

  function isActive(item: NavItem): boolean {
    if (item.cat) return activePath === '/' && currentCat === item.cat;
    return item.href === '/' ? activePath === '/' : activePath.startsWith(item.href);
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

  function addSchemaRow() {
    newSchemas = [...newSchemas, { name: '', schema: '' }];
  }
  function removeSchemaRow(i: number) {
    newSchemas = newSchemas.filter((_, idx) => idx !== i);
  }

  async function submitCreate() {
    if (!newName.trim()) return;
    creating = true;
    createError = '';
    try {
      const project = await createProject({
        name: newName.trim(),
        classification: newClassification,
        description: newDescription.trim() || undefined,
        repoUrl: newRepoUrl.trim() || undefined,
        repoPath: newRepoPath.trim() || undefined,
        context: newContext.trim() || undefined,
        schemas: newSchemas.filter((s) => s.name.trim() && s.schema.trim()).map((s) => ({ name: s.name.trim(), schema: s.schema })),
      });
      setActiveProject(project.id);
      location.reload();
    } catch (e) {
      createError = e instanceof Error ? e.message : 'Failed to create project';
    } finally {
      creating = false;
    }
  }

  function toggleTheme() {
    theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('arbiter-theme', theme);
  }

  async function afterAuth() {
    try {
      await loadProjects();
    } catch {
      /* API-only / offline */
    }
  }

  function onLoggedIn(user: AuthUser) {
    currentUser = user;
    needLogin = false;
    void afterAuth();
  }

  async function doLogout() {
    userMenuOpen = false;
    await logout();
    location.reload();
  }

  onMount(async () => {
    const saved = localStorage.getItem('arbiter-theme') as 'light' | 'dark' | null;
    theme = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;

    // Status is public — it tells us whether auth is enabled.
    try {
      status = await getStatus();
    } catch {
      status = null;
    }
    const authEnabled = status?.authEnabled ?? false;
    if (!authEnabled) {
      needLogin = false;
    } else {
      const me = await getMe().catch(() => null);
      if (me) {
        currentUser = me;
        needLogin = false;
      } else {
        needLogin = true;
      }
    }
    authReady = true;
    if (!needLogin) await afterAuth();
  });
</script>

{#if !authReady}
  <div style="min-height:100vh"></div>
{:else if needLogin}
  <Login onLogin={onLoggedIn} />
{:else}
<a class="skip-link" href="#main-content">Skip to main content</a>

<div class="app-shell">
  <aside class="sidebar" class:open={sidebarOpen}>
    <div class="brand">
      <span class="brand-mark" aria-hidden="true"><Icon name="scale" size={22} strokeWidth={2.25} /></span>
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
          class:active={isActive(item)}
          onclick={() => (sidebarOpen = false)}
        >
          <span class="ico" aria-hidden="true"><Icon name={item.ico} size={17} /></span>
          {item.label}
        </a>
      {/each}
    {/each}
  </aside>

  <div>
    <header class="topbar">
      <div style="display:flex;align-items:center;gap:10px">
        <button class="iconbtn menu-toggle" aria-label="Toggle menu" onclick={() => (sidebarOpen = !sidebarOpen)}><Icon name="menu" /></button>
        <span class="page-title">{pageTitle}</span>
      </div>

      <div class="topbar-right">
        {#if projects.length > 0}
          <div style="position:relative">
            <button class="proj-switch" onclick={() => (projMenuOpen = !projMenuOpen)} aria-haspopup="menu" aria-expanded={projMenuOpen}>
              <span class="dot"></span>
              {currentProject?.name ?? 'Project'}
              <Icon name="chevron" size={14} class="op6" />
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
                <button class="dd-item accent" role="menuitem" onclick={() => { projMenuOpen = false; showCreate = true; }}><Icon name="plus" size={15} /> New project</button>
              </div>
            {/if}
          </div>
        {/if}

        {#if status}
          <div class="status-pop">
            <button class="iconbtn" aria-label="System status" title="System status" onclick={() => (statusOpen = !statusOpen)}><Icon name="status" size={17} /></button>
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

        <button class="iconbtn" aria-label="Toggle theme" onclick={toggleTheme}><Icon name="theme" size={17} /></button>

        {#if currentUser}
          <div style="position:relative">
            <button class="avatar" aria-label="Account menu" onclick={() => (userMenuOpen = !userMenuOpen)} title={currentUser.email}>
              {currentUser.email[0]?.toUpperCase() ?? '?'}
            </button>
            {#if userMenuOpen}
              <button class="menu-scrim" aria-label="Close menu" onclick={() => (userMenuOpen = false)}></button>
              <div class="dropdown" role="menu" style="width:220px">
                <div style="padding:8px 10px">
                  <div style="font-weight:600;font-size:13px;word-break:break-all">{currentUser.email}</div>
                  <div style="font-size:11px;color:var(--muted);text-transform:capitalize">{currentUser.role}</div>
                </div>
                <div class="dd-sep"></div>
                <button class="dd-item" role="menuitem" onclick={doLogout}>Sign out</button>
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </header>

    <main id="main-content" tabindex="-1" class="content">
      {@render children()}
    </main>
  </div>
</div>
{/if}

{#if showCreate}
  <Modal title="New project" subtitle="Set up a fresh, isolated project — its runs, review queue, knowledge, schemas, and metrics are its own." onclose={() => (showCreate = false)}>
    <div class="form-grid">
      <label class="field">
        <span>Project name *</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input type="text" placeholder="e.g. Checkout revamp" bind:value={newName} autofocus />
      </label>
      <label class="field">
        <span>Data classification</span>
        <select bind:value={newClassification}>
          <option value="public">public</option>
          <option value="internal">internal</option>
          <option value="confidential">confidential</option>
          <option value="restricted">restricted</option>
        </select>
      </label>
    </div>

    <label class="field">
      <span>Description <span class="opt">optional</span></span>
      <input type="text" placeholder="What is this project about?" bind:value={newDescription} />
    </label>

    <div class="form-grid">
      <label class="field">
        <span>Repository URL <span class="opt">optional</span></span>
        <input type="text" placeholder="https://github.com/org/repo" bind:value={newRepoUrl} />
      </label>
      <label class="field">
        <span>Repository path <span class="opt">optional</span></span>
        <input type="text" placeholder="/Users/you/src/repo" bind:value={newRepoPath} />
      </label>
    </div>

    <label class="field">
      <span>Initial context / knowledge <span class="opt">optional — seeded into this project's knowledge</span></span>
      <textarea rows="3" placeholder="Paste a schema, spec, or notes to ground this project…" bind:value={newContext}></textarea>
    </label>

    <div class="field">
      <span>JSON Schemas <span class="opt">optional — saved for the Schema Validator</span></span>
      {#each newSchemas as s, i}
        <div class="schema-row">
          <input type="text" placeholder="Schema name (e.g. Order v2)" bind:value={s.name} />
          <textarea rows="2" placeholder={'{ "type": "object", "required": ["id"] }'} bind:value={s.schema}></textarea>
          <button class="ghost small" style="margin:0" aria-label="Remove schema" onclick={() => removeSchemaRow(i)}><Icon name="close" size={14} /></button>
        </div>
      {/each}
      <button class="ghost small" style="margin:6px 0 0;display:inline-flex;align-items:center;gap:6px" onclick={addSchemaRow}><Icon name="plus" size={14} /> Add schema</button>
    </div>

    {#if createError}<p class="error" role="alert">{createError}</p>{/if}

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
