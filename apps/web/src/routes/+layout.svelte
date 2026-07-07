<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getStatus, type StatusInfo } from '$lib/api';

  let { children } = $props();
  let status = $state<StatusInfo | null>(null);
  let theme = $state<'light' | 'dark'>('light');

  onMount(async () => {
    const saved = localStorage.getItem('arbiter-theme') as 'light' | 'dark' | null;
    theme = saved ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = theme;
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
    <a href="/prompts" class:active={$page.url.pathname.startsWith('/prompts')}>Prompts</a>
  </nav>
  <div class="topbar-right">
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

{@render children()}

<style>
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
</style>
