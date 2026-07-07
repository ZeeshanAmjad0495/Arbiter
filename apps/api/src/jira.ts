import { getConfig } from '@arbiter/config';

export interface JiraContext {
  title: string;
  content: string;
  sourceType: 'jira';
}

interface AdfNode {
  type?: string;
  text?: string;
  content?: AdfNode[];
}

/** Flatten Atlassian Document Format (Jira description) to plain text. */
function adfToText(node: AdfNode | undefined): string {
  if (!node) return '';
  if (typeof node.text === 'string') return node.text;
  const children = (node.content ?? []).map(adfToText).join('');
  if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem') return `${children}\n`;
  return children;
}

/**
 * Read-only Jira fetch-by-ticket-key (Phase 1 grounding pull-forward). Returns a
 * context item so the grounding validator can check generated references against
 * the real ticket. Never writes to Jira (writes are Phase 3, via WriteGate).
 */
export async function fetchJiraIssue(key: string): Promise<JiraContext> {
  const { env } = getConfig();
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) {
    throw new Error('jira_not_configured');
  }
  const auth = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  const url = `${env.JIRA_BASE_URL.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status`;
  const res = await fetch(url, { headers: { authorization: `Basic ${auth}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`jira_error_${res.status}`);

  const data = (await res.json()) as {
    fields?: { summary?: string; description?: AdfNode | string | null; status?: { name?: string } };
  };
  const f = data.fields ?? {};
  const summary = f.summary ?? '';
  const description = typeof f.description === 'string' ? f.description : adfToText(f.description ?? undefined).trim();
  const status = f.status?.name ?? '';
  const content = [`${key}: ${summary}`, description, status ? `Status: ${status}` : ''].filter(Boolean).join('\n\n');
  return { title: `${key} — ${summary}`.trim(), content, sourceType: 'jira' };
}
