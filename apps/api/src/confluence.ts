import { getConfig } from '@arbiter/config';

export interface ConfluenceContext {
  title: string;
  content: string;
  sourceType: 'confluence';
}

/**
 * READ-ONLY against Confluence, same non-negotiable pattern as Jira: every
 * Confluence HTTP call goes through here, which refuses any method other than
 * GET/HEAD. Arbiter pulls pages as grounding context; it never writes to the wiki.
 */
export async function confluenceReadOnlyFetch(url: string, headers: Record<string, string>, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(`confluence_write_forbidden: Arbiter is read-only against Confluence (attempted ${String(method)})`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetch(url, { method, headers, signal: controller.signal });
  } catch (error) {
    throw new Error(controller.signal.aborted ? 'confluence_timeout' : `confluence_unreachable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Confluence storage-format (XHTML) → plain text. Strips tags, decodes the few common entities. */
export function storageToText(html: string): string {
  return html
    .replace(/<\/(p|h[1-6]|li|tr|div|br)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Read-only Confluence fetch-by-page-id. Returns a grounding context item so the
 * grounding validator can check generated references against the real page.
 * NEVER writes (enforced by confluenceReadOnlyFetch).
 */
export async function fetchConfluencePage(id: string): Promise<ConfluenceContext> {
  const { env } = getConfig();
  if (!env.CONFLUENCE_BASE_URL || !env.CONFLUENCE_EMAIL || !env.CONFLUENCE_API_TOKEN) {
    throw new Error('confluence_not_configured');
  }
  const auth = Buffer.from(`${env.CONFLUENCE_EMAIL}:${env.CONFLUENCE_API_TOKEN}`).toString('base64');
  const url = `${env.CONFLUENCE_BASE_URL.replace(/\/$/, '')}/wiki/rest/api/content/${encodeURIComponent(id)}?expand=body.storage`;
  const res = await confluenceReadOnlyFetch(url, { authorization: `Basic ${auth}`, accept: 'application/json' });
  if (!res.ok) throw new Error(`confluence_error_${res.status}`);

  const data = (await res.json()) as { title?: string; body?: { storage?: { value?: string } } };
  const title = data.title ?? `Confluence page ${id}`;
  const content = storageToText(data.body?.storage?.value ?? '');
  return { title, content: [title, content].filter(Boolean).join('\n\n'), sourceType: 'confluence' };
}
