import type { ArbiterConfig } from '@arbiter/config';

/**
 * READ-ONLY observability ground sources — FREE/OSS only (Sentry + Grafana; Grafana's
 * Loki/Prometheus datasources cover logs+metrics, so no paid Datadog/Splunk).
 *
 * Non-negotiable read-only posture: every call goes through obsReadOnlyFetch, which
 * refuses any method other than GET/HEAD before a request is sent. These connectors
 * cannot mutate Sentry or Grafana. Results are normalized to ObsItem[] and SANITIZED
 * by the caller before storage.
 */
export interface ObsItem {
  title: string;
  content: string;
}

export async function obsReadOnlyFetch(url: string, headers: Record<string, string>, method: 'GET' | 'HEAD' = 'GET'): Promise<Response> {
  if (method !== 'GET' && method !== 'HEAD') {
    throw new Error(`observability_write_forbidden: read-only connector rejected method ${String(method)}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    return await fetch(url, { method, headers, signal: controller.signal });
  } catch (error) {
    throw new Error(controller.signal.aborted ? 'observability_timeout' : `observability_unreachable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------- Sentry -------------------------------- *
 * Recent unresolved issues — the highest-signal slice for bug/CI triage.   */

interface SentryIssue {
  shortId?: string;
  title?: string;
  culprit?: string;
  level?: string;
  status?: string;
  count?: string;
  userCount?: number;
  lastSeen?: string;
  permalink?: string;
}

export async function fetchSentryIssues(config: ArbiterConfig, opts: { query?: string; limit?: number } = {}): Promise<ObsItem[]> {
  const { env } = config;
  if (!config.sentry.configured || !env.SENTRY_ORG || !env.SENTRY_AUTH_TOKEN) return [];
  const query = opts.query ?? 'is:unresolved';
  const url = `${env.SENTRY_BASE_URL.replace(/\/$/, '')}/api/0/organizations/${encodeURIComponent(env.SENTRY_ORG)}/issues/?query=${encodeURIComponent(query)}&statsPeriod=14d&limit=${opts.limit ?? 100}`;
  const res = await obsReadOnlyFetch(url, { authorization: `Bearer ${env.SENTRY_AUTH_TOKEN}`, accept: 'application/json' });
  if (!res.ok) throw new Error(`sentry_error_${res.status}`);
  const issues = (await res.json()) as SentryIssue[];
  return issues.map((i) => ({
    title: `Sentry ${i.shortId ?? ''}: ${i.title ?? '(untitled)'}`.trim(),
    content: [
      `${i.shortId ?? ''} — ${i.title ?? ''}`,
      i.culprit ? `Culprit: ${i.culprit}` : '',
      `Level: ${i.level ?? '?'} · Status: ${i.status ?? '?'} · Events: ${i.count ?? '?'} · Users: ${i.userCount ?? 0}`,
      i.lastSeen ? `Last seen: ${i.lastSeen}` : '',
      i.permalink ? `Link: ${i.permalink}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  }));
}

/* ------------------------------- Grafana ------------------------------- *
 * Dashboards + alert rules — what's monitored and what alerts exist. Its
 * Loki/Prometheus datasources (OSS) can be queried read-only next.          */

interface GrafanaDash {
  title?: string;
  tags?: string[];
  url?: string;
  folderTitle?: string;
}
interface GrafanaAlertRule {
  title?: string;
  condition?: string;
  folderUID?: string;
  ruleGroup?: string;
}

export async function fetchGrafanaContext(config: ArbiterConfig): Promise<ObsItem[]> {
  const { env } = config;
  if (!config.grafana.configured || !env.GRAFANA_URL || !env.GRAFANA_TOKEN) return [];
  const base = env.GRAFANA_URL.replace(/\/$/, '');
  const headers = { authorization: `Bearer ${env.GRAFANA_TOKEN}`, accept: 'application/json' };
  const items: ObsItem[] = [];

  const dashRes = await obsReadOnlyFetch(`${base}/api/search?type=dash-db&limit=500`, headers);
  if (dashRes.ok) {
    const dashboards = (await dashRes.json()) as GrafanaDash[];
    if (dashboards.length) {
      items.push({
        title: `Grafana dashboards (${dashboards.length})`,
        content: dashboards.map((d) => `- ${d.title ?? '(untitled)'}${d.folderTitle ? ` [${d.folderTitle}]` : ''}${d.tags?.length ? ` · ${d.tags.join(', ')}` : ''}`).join('\n'),
      });
    }
  }

  // Provisioning API lists all alert rules (read-only GET).
  const alertRes = await obsReadOnlyFetch(`${base}/api/v1/provisioning/alert-rules`, headers);
  if (alertRes.ok) {
    const rules = (await alertRes.json()) as GrafanaAlertRule[];
    if (rules.length) {
      items.push({
        title: `Grafana alert rules (${rules.length})`,
        content: rules.map((r) => `- ${r.title ?? '(untitled)'}${r.ruleGroup ? ` (${r.ruleGroup})` : ''}${r.condition ? ` — condition: ${r.condition}` : ''}`).join('\n'),
      });
    }
  }
  return items;
}

/** Collect from every configured (free/OSS) observability source. */
export async function collectObservability(config: ArbiterConfig): Promise<{ source: string; items: ObsItem[] }[]> {
  const out: { source: string; items: ObsItem[] }[] = [];
  if (config.sentry.configured) out.push({ source: 'sentry', items: await fetchSentryIssues(config) });
  if (config.grafana.configured) out.push({ source: 'grafana', items: await fetchGrafanaContext(config) });
  return out;
}
