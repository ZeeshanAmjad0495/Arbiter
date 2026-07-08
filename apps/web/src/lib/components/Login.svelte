<script lang="ts">
  import { login, type AuthUser } from '$lib/api';
  import Icon from './Icon.svelte';

  let { onLogin }: { onLogin: (u: AuthUser) => void } = $props();
  let email = $state('');
  let key = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit() {
    if (!email.trim() || !key.trim()) return;
    busy = true;
    error = '';
    try {
      const u = await login(email.trim(), key.trim());
      onLogin(u);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Login failed';
    } finally {
      busy = false;
    }
  }
</script>

<main class="login-wrap">
  <div class="login-card">
    <div class="brand"><span class="mark"><Icon name="scale" size={24} strokeWidth={2.25} /></span> Arbiter</div>
    <p class="sub">Sign in with the access key sent to your email.</p>
    <label class="field">
      <span>Email</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="email" bind:value={email} placeholder="you@company.com" autofocus onkeydown={(e) => e.key === 'Enter' && submit()} />
    </label>
    <label class="field">
      <span>Access key</span>
      <input type="password" bind:value={key} placeholder="ak_…" onkeydown={(e) => e.key === 'Enter' && submit()} />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <button class="primary" style="margin-top:6px" disabled={busy || !email.trim() || !key.trim()} onclick={submit}>
      {busy ? 'Signing in…' : 'Sign in'}
    </button>
    <p class="hint">Don't have a key? Ask an admin to issue one for your email.</p>
  </div>
</main>

<style>
  .login-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg);
  }
  .login-card {
    width: 100%;
    max-width: 380px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 12px 40px var(--shadow);
    padding: 28px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.3px;
  }
  .brand .mark {
    display: inline-flex;
    color: var(--accent);
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    margin: 6px 0 20px;
  }
  .hint {
    color: var(--muted);
    font-size: 12px;
    margin: 14px 0 0;
    text-align: center;
  }
</style>
