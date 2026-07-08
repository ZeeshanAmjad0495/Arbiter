<script lang="ts">
  import { onMount } from 'svelte';
  import { issueKey, listAdminUsers, listProjects, setUserProjects, setUserRole, type AdminUser, type ProjectInfo } from '$lib/api';
  import Icon from '$lib/components/Icon.svelte';

  let users = $state<AdminUser[]>([]);
  let projects = $state<ProjectInfo[]>([]);
  let defaultProjectId = $state('');
  let error = $state<string | null>(null);
  let saving = $state<string | null>(null);

  // invite
  let inviteEmail = $state('');
  let inviteRole = $state('qa');
  let inviting = $state(false);
  let issuedKey = $state<{ email: string; key: string } | null>(null);

  async function load() {
    error = null;
    try {
      const [u, p] = await Promise.all([listAdminUsers(), listProjects()]);
      users = u;
      projects = p.projects;
      defaultProjectId = p.defaultProjectId;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load';
    }
  }

  async function changeRole(u: AdminUser, role: string) {
    saving = u.id;
    try {
      await setUserRole(u.id, role);
      u.role = role;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed';
    } finally {
      saving = null;
    }
  }

  async function toggleProject(u: AdminUser, projectId: string, on: boolean) {
    saving = u.id;
    const next = on ? [...u.projectIds, projectId] : u.projectIds.filter((id) => id !== projectId);
    try {
      await setUserProjects(u.id, next);
      u.projectIds = next;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed';
    } finally {
      saving = null;
    }
  }

  async function invite() {
    if (!inviteEmail.trim()) return;
    inviting = true;
    error = null;
    issuedKey = null;
    try {
      const r = await issueKey(inviteEmail.trim(), inviteRole);
      issuedKey = { email: r.user.email, key: r.key };
      inviteEmail = '';
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to invite';
    } finally {
      inviting = false;
    }
  }

  onMount(load);
</script>

<section class="wrap">
  <div class="head">
    <h2>Users &amp; Access</h2>
    <p class="sub">Invite people, set their role, and choose which projects each person can see. Admins can see every project.</p>
  </div>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <section class="card invite">
    <h3>Invite a person</h3>
    <div class="invite-row">
      <input type="email" placeholder="name@company.com" bind:value={inviteEmail} aria-label="Email to invite" />
      <select bind:value={inviteRole} aria-label="Role for the invited person">
        <option value="qa">QA</option>
        <option value="qa_lead">QA lead</option>
        <option value="admin">Admin</option>
      </select>
      <button class="primary" style="width:auto" disabled={inviting || !inviteEmail.trim()} onclick={invite}>
        <Icon name="plus" size={15} /> {inviting ? 'Creating…' : 'Create access key'}
      </button>
    </div>
    {#if issuedKey}
      <div class="banner good" style="margin-top:12px">
        <b>Temporary</b> access key for <b>{issuedKey.email}</b> — email it to them securely (shown once). They'll set their own permanent key on first sign-in.
        <code class="key">{issuedKey.key}</code>
      </div>
    {/if}
  </section>

  <section class="card">
    <h3>People ({users.length})</h3>
    <div class="tbl-scroll">
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Project access {#if saving}<span class="saving">saving…</span>{/if}</th>
          </tr>
        </thead>
        <tbody>
          {#each users as u (u.id)}
            <tr>
              <td class="email">{u.email}{u.hasKey ? '' : ' (no key yet)'}</td>
              <td>
                <select value={u.role} aria-label={`Role for ${u.email}`} onchange={(e) => changeRole(u, (e.target as HTMLSelectElement).value)}>
                  <option value="qa">QA</option>
                  <option value="qa_lead">QA lead</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td>
                {#if u.role === 'admin'}
                  <span class="all">All projects (admin)</span>
                {:else}
                  <div class="proj-checks">
                    {#each projects as p}
                      {@const isDefault = p.id === defaultProjectId}
                      <label class="pcheck" title={isDefault ? 'Everyone can see the default project' : ''}>
                        <input
                          type="checkbox"
                          checked={isDefault || u.projectIds.includes(p.id)}
                          disabled={isDefault || saving === u.id}
                          onchange={(e) => toggleProject(u, p.id, (e.target as HTMLInputElement).checked)}
                        />
                        {p.name}
                      </label>
                    {/each}
                  </div>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</section>

<style>
  .wrap {
    max-width: 1040px;
    margin: 0 auto;
  }
  .head {
    margin-bottom: 18px;
  }
  .sub {
    color: var(--muted);
    font-size: 13px;
    margin: 4px 0 0;
  }
  .card h3 {
    margin: 0 0 12px;
    font-size: 14px;
  }
  .invite {
    margin-bottom: 16px;
  }
  .invite-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .invite-row input {
    flex: 1;
    min-width: 220px;
  }
  .key {
    display: block;
    margin-top: 6px;
    font-family: ui-monospace, monospace;
    font-size: 12.5px;
    word-break: break-all;
  }
  .tbl-scroll {
    overflow-x: auto;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }
  th {
    text-align: left;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--muted);
    padding: 6px 10px;
    border-bottom: 1px solid var(--line-strong);
  }
  td {
    padding: 10px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  .email {
    font-weight: 500;
  }
  .all {
    color: var(--muted);
    font-size: 12px;
  }
  .proj-checks {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .pcheck {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    white-space: nowrap;
  }
  .saving {
    color: var(--muted);
    font-size: 10px;
    text-transform: none;
    letter-spacing: 0;
    margin-left: 6px;
  }
</style>
