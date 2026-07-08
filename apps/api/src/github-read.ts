import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);

/**
 * READ-ONLY GitHub access, same non-negotiable posture as the Jira connector.
 *
 * This module can ONLY read. It shells out to the authenticated `gh` CLI but
 * exposes no method/verb parameter and never passes `-X`/`--method`/`-f`/`--input`
 * (the flags that would make `gh api` mutate). So creating issues, comments,
 * branches, PRs, or pushing is structurally impossible here. A hard guard also
 * rejects any path that looks like a mutating call.
 */

// Belt-and-suspenders: refuse anything that isn't a plain read path.
export function assertReadOnly(path: string): void {
  if (/(^|\s)-X\b|--method|--input\b|(^|\s)-f\b|(^|\s)-F\b/.test(path)) {
    throw new Error(`github_write_forbidden: read-only connector rejected a mutating argument (${path})`);
  }
}

/** GET a GitHub REST path via `gh api` and parse JSON. `paginate` follows Link headers. */
export async function ghRead<T = unknown>(path: string, opts: { paginate?: boolean } = {}): Promise<T> {
  assertReadOnly(path);
  const args = ['api', ...(opts.paginate ? ['--paginate', '--slurp'] : []), '-H', 'Accept: application/vnd.github+json', path];
  const { stdout } = await execFileP('gh', args, { maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout) as T;
}

/** GET a raw (non-JSON) GitHub artifact — e.g. a repo tarball — to a Buffer. */
export async function ghReadRaw(path: string): Promise<Buffer> {
  assertReadOnly(path);
  const { stdout } = await execFileP('gh', ['api', path], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
  return stdout as Buffer;
}

export interface GhRepo {
  name: string;
  description: string | null;
  language: string | null;
  visibility: string;
  topics?: string[];
  updated_at: string;
  archived: boolean;
  html_url: string;
}

/** All repos in an org (paginated). Read-only. */
export async function listOrgRepos(org: string): Promise<GhRepo[]> {
  // --slurp wraps the paginated pages into an array-of-arrays; flatten it.
  const pages = await ghRead<GhRepo[][]>(`orgs/${encodeURIComponent(org)}/repos?per_page=100&type=all`, { paginate: true });
  return pages.flat();
}

/** A repo's README as decoded text, or null if it has none. Read-only. */
export async function readRepoReadme(org: string, repo: string): Promise<string | null> {
  try {
    const res = await ghRead<{ content?: string; encoding?: string }>(`repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/readme`);
    if (!res.content) return null;
    return Buffer.from(res.content, (res.encoding as BufferEncoding) ?? 'base64').toString('utf8');
  } catch {
    return null; // no README (404) — expected for many repos
  }
}

export interface GhTreeEntry {
  path: string;
  type: string;
}

/** The full recursive file tree of a repo branch. Read-only. */
export async function listRepoTree(org: string, repo: string, branch: string): Promise<GhTreeEntry[]> {
  const res = await ghRead<{ tree?: GhTreeEntry[] }>(`repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return res.tree ?? [];
}

export async function repoDefaultBranch(org: string, repo: string): Promise<string> {
  const res = await ghRead<{ default_branch?: string }>(`repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`);
  return res.default_branch ?? 'main';
}
