import type { ArbiterConfig } from '@arbiter/config';
import { SandboxWriteTarget, type WritePlan, type WriteTarget } from './writegate';

/**
 * GitHub — the first REAL WriteGate target. Creates issues / issue-comments in
 * ONE configured repo, and only ever through the WriteGate (named human approval
 * → apply → verify → audit). It is a WRITE target, so it needs a token; when the
 * repo isn't configured the factory registers the {@link SandboxWriteTarget}
 * instead. It can never be the connected Jira workspace (id is always 'github',
 * and the WriteGate hard-refuses Jira ids regardless).
 *
 * `fetchImpl` is injectable so the write path is unit-testable without network.
 */
export interface GitHubWriteConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
  readonly apiUrl?: string;
  readonly fetchImpl?: typeof fetch;
}

/** What a 'create'/'comment' plan carries in `plan.payload`. */
export interface GitHubIssuePayload {
  readonly title?: string;
  readonly body?: string;
  readonly labels?: string[];
  /** For a comment: the issue number to comment on. */
  readonly issueNumber?: number;
}

export class GitHubWriteTarget implements WriteTarget {
  readonly id = 'github';
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly cfg: GitHubWriteConfig) {
    this.base = (cfg.apiUrl ?? 'https://api.github.com').replace(/\/$/, '');
    this.doFetch = cfg.fetchImpl ?? fetch;
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
    };
  }

  private issuesUrl(): string {
    return `${this.base}/repos/${encodeURIComponent(this.cfg.owner)}/${encodeURIComponent(this.cfg.repo)}/issues`;
  }

  async apply(plan: WritePlan): Promise<{ reference: string }> {
    const payload = (plan.payload ?? {}) as GitHubIssuePayload;

    if (plan.action === 'comment') {
      if (!payload.issueNumber) throw new Error('github_comment_requires_issueNumber');
      const url = `${this.issuesUrl()}/${payload.issueNumber}/comments`;
      const res = await this.doFetch(url, { method: 'POST', headers: this.headers(), body: JSON.stringify({ body: payload.body ?? plan.summary }) });
      if (!res.ok) throw new Error(`github_error_${res.status}`);
      const data = (await res.json()) as { html_url?: string; id?: number };
      return { reference: data.html_url ?? `comment:${data.id ?? '?'}` };
    }

    // Default: create an issue.
    const body = {
      title: payload.title ?? plan.summary.slice(0, 120),
      body: payload.body ?? plan.summary,
      ...(payload.labels && payload.labels.length ? { labels: payload.labels } : {}),
    };
    const res = await this.doFetch(this.issuesUrl(), { method: 'POST', headers: this.headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`github_error_${res.status}`);
    const data = (await res.json()) as { html_url?: string; number?: number };
    return { reference: data.html_url ?? `#${data.number ?? '?'}` };
  }

  async verify(_plan: WritePlan, reference: string): Promise<boolean> {
    // Re-GET the created resource. Extract the issue number from the html_url or #n ref.
    const num = reference.match(/\/issues\/(\d+)|#(\d+)/);
    const issueNumber = num ? (num[1] ?? num[2]) : null;
    if (!issueNumber) return false;
    const res = await this.doFetch(`${this.issuesUrl()}/${issueNumber}`, { method: 'GET', headers: this.headers() });
    return res.ok;
  }
}

/**
 * The real write destination when GitHub is configured, else the safe in-memory
 * sandbox. Real vs offline is a config decision, exactly like the rest of the stack.
 */
export function writeTargetFor(config: ArbiterConfig): WriteTarget {
  const { env } = config;
  if (config.github.configured && env.GITHUB_TOKEN && env.GITHUB_OWNER && env.GITHUB_REPO) {
    return new GitHubWriteTarget({ token: env.GITHUB_TOKEN, owner: env.GITHUB_OWNER, repo: env.GITHUB_REPO, apiUrl: env.GITHUB_API_URL });
  }
  return new SandboxWriteTarget();
}
