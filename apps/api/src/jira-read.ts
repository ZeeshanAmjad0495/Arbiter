/**
 * Generic READ-ONLY Jira connector — for ingesting any Jira Cloud site's tickets
 * as project context. Parameterized by base URL + email + API token (Basic auth),
 * so it works for any site, not one hard-coded workspace.
 *
 * READ-ONLY, non-negotiable: every request goes through jiraSiteReadOnlyFetch,
 * which refuses any method other than GET/HEAD before a request is sent. Writing
 * to a Jira workspace is structurally impossible here.
 */
export interface JiraSite {
  readonly baseUrl: string;
  readonly email: string;
  readonly token: string;
}

export interface JiraIssue {
  key: string;
  summary: string;
  description: string;
  type: string;
  status: string;
  priority: string;
  labels: string[];
  comments: string[];
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Flatten Atlassian Document Format (Jira rich text) to plain text. */
export function adfToText(node: AdfNode | string | undefined | null): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.text === 'string') return node.text;
  const children = (node.content ?? []).map(adfToText).join('');
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') return `${children}\n`;
  return children;
}

export async function jiraSiteReadOnlyFetch(site: JiraSite, path: string, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(`jira_write_forbidden: Arbiter is read-only against Jira (attempted ${String(method)})`);
  }
  const auth = Buffer.from(`${site.email}:${site.token}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    return await fetch(`${site.baseUrl.replace(/\/$/, '')}${path}`, { method, headers: { authorization: `Basic ${auth}`, accept: 'application/json' }, signal: controller.signal });
  } catch (error) {
    throw new Error(controller.signal.aborted ? 'jira_timeout' : `jira_unreachable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull every issue matching `jql` (all statuses by default), paginated. Read-only.
 * Uses Jira Cloud's current `/search/jql` endpoint (token pagination) — the old
 * `/search` (startAt/total) is deprecated. `/search/jql` requires a BOUNDED JQL,
 * so the default adds a permissive date restriction that still matches everything.
 */
export async function fetchAllIssues(site: JiraSite, jql = 'created >= "2000-01-01" ORDER BY created ASC', onPage?: (n: number) => void): Promise<JiraIssue[]> {
  const out: JiraIssue[] = [];
  const fields = 'summary,description,issuetype,status,priority,labels,comment';
  let nextPageToken: string | undefined;
  for (;;) {
    const tokenParam = nextPageToken ? `&nextPageToken=${encodeURIComponent(nextPageToken)}` : '';
    const res = await jiraSiteReadOnlyFetch(site, `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=${fields}&maxResults=100${tokenParam}`);
    if (!res.ok) throw new Error(`jira_error_${res.status}: ${await res.text().catch(() => '')}`.slice(0, 300));
    const data = (await res.json()) as { issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean };
    for (const raw of data.issues ?? []) out.push(normalize(raw));
    onPage?.(out.length);
    nextPageToken = data.nextPageToken;
    if (data.isLast || !nextPageToken || !data.issues?.length) break;
  }
  return out;
}

interface RawIssue {
  key: string;
  fields?: {
    summary?: string;
    description?: AdfNode | string | null;
    issuetype?: { name?: string };
    status?: { name?: string };
    priority?: { name?: string };
    labels?: string[];
    comment?: { comments?: { body?: AdfNode | string }[] };
  };
}

function normalize(raw: RawIssue): JiraIssue {
  const f = raw.fields ?? {};
  return {
    key: raw.key,
    summary: f.summary ?? '',
    description: adfToText(f.description).trim(),
    type: f.issuetype?.name ?? '',
    status: f.status?.name ?? '',
    priority: f.priority?.name ?? '',
    labels: f.labels ?? [],
    comments: (f.comment?.comments ?? []).map((c) => adfToText(c.body).trim()).filter(Boolean),
  };
}
