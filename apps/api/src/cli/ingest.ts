/**
 * Generic READ-ONLY context ingestion. Pulls a curated, high-signal context from
 * a GitHub org and/or a Jira Cloud site into an Arbiter project's knowledge store
 * (RLS-isolated, sanitized before storage). NOT specific to any one org/site —
 * everything is parameterized. Refreshable (clears then re-ingests).
 *
 * STRICTLY READ-ONLY against GitHub and Jira — enforced by the github-read /
 * jira-read connectors, which cannot mutate.
 *
 * Usage:
 *   DATABASE_URL=… pnpm ingest --project "<name>" \
 *     [--github-org <org> [--docs-repo <repo>]] \
 *     [--jira <baseUrl> --jira-email <email> --jira-token-env <ENV_VAR> [--jira-jql "<jql>"]]
 *
 * Example (Zuub, using creds from env):
 *   pnpm ingest --project Zuub --github-org zuub --docs-repo documentation \
 *     --jira https://zuub-team.atlassian.net --jira-email you@zuub.com --jira-token-env ZUUB_JIRA_API_TOKEN
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { getConfig } from '@arbiter/config';
import { KnowledgeChunk, KnowledgeDocument, Project, type ProjectId, newKnowledgeDocId, newProjectId, nowIso } from '@arbiter/core';
import { type RepositoryBundle, createPostgresRepositories } from '@arbiter/db';
import { buildChunks, embedTexts, embeddingsEnabled } from '@arbiter/guardrail';
import { type SanitizePort, createSanitizer } from '@arbiter/sanitize';
import { ghReadRaw, listOrgRepos, readRepoReadme, repoDefaultBranch } from '../github-read';
import { type JiraSite, fetchAllIssues } from '../jira-read';

const execFileP = promisify(execFile);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** One sanitize-then-store helper, shared by every source. Never stores raw PII/secrets. */
function makeStore(repos: RepositoryBundle, sanitizer: SanitizePort, projectId: ProjectId, dense: boolean) {
  let docs = 0;
  let chunks = 0;
  const store = async (title: string, content: string, citation: string, sourceType: KnowledgeDocument['sourceType']): Promise<void> => {
    const safe = (await sanitizer.sanitize(content, projectId)).sanitizedText;
    if (!safe.trim()) return;
    const docId = newKnowledgeDocId();
    const built: KnowledgeChunk[] = buildChunks(projectId, docId, safe);
    await repos.knowledge.addDocument(KnowledgeDocument.parse({ id: docId, projectId, title: title.slice(0, 200), sourceType, citation, classification: 'confidential', createdAt: nowIso() }), built);
    if (dense && built.length) {
      const vecs = await embedTexts(built.map((c) => c.content));
      await Promise.all(built.map((c, i) => (vecs[i] ? repos.knowledge.setChunkEmbedding(projectId, c.id, vecs[i]!) : Promise.resolve())));
    }
    docs += 1;
    chunks += built.length;
  };
  return { store, stats: () => ({ docs, chunks }) };
}

async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      out.push(...(await walkMarkdown(full)));
    } else if (entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

async function ingestGitHub(store: Awaited<ReturnType<typeof makeStore>>['store'], org: string, docsRepo?: string): Promise<void> {
  console.log(`› GitHub org "${org}": reading inventory (read-only)…`);
  const repos = (await listOrgRepos(org)).filter((r) => !r.archived);
  const inventory = [`# ${org} GitHub repositories (${repos.length})`, '', ...repos.sort((a, b) => (b.updated_at < a.updated_at ? -1 : 1)).map((r) => `- **${r.name}** (${r.language ?? 'n/a'}) — ${r.description ?? 'no description'}${r.topics?.length ? ` · ${r.topics.join(', ')}` : ''}`)].join('\n');
  await store('Repository inventory', inventory, `github://${org}/inventory`, 'repo');

  if (docsRepo) {
    console.log(`› GitHub: reading docs repo "${docsRepo}" (one read-only tarball)…`);
    const branch = await repoDefaultBranch(org, docsRepo);
    const tar = await ghReadRaw(`repos/${org}/${docsRepo}/tarball/${branch}`);
    const dir = await mkdtemp(join(tmpdir(), 'ctx-docs-'));
    try {
      const tgz = join(dir, 'docs.tar.gz');
      await writeFile(tgz, tar);
      await execFileP('tar', ['-xzf', tgz, '-C', dir]);
      const roots = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
      const root = roots.length ? join(dir, roots[0]!.name) : dir;
      for (const path of await walkMarkdown(root)) {
        const content = await readFile(path, 'utf8');
        if (content.trim()) await store(`docs/${relative(root, path)}`, content, `github://${org}/${docsRepo}`, 'repo');
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  console.log(`› GitHub: reading ${repos.length} repo READMEs (read-only)…`);
  for (const r of repos) {
    if (r.name === docsRepo) continue;
    const readme = await readRepoReadme(org, r.name);
    if (readme?.trim()) await store(`${r.name}/README`, readme, `github://${org}/${r.name}`, 'repo');
  }
}

async function ingestJira(store: Awaited<ReturnType<typeof makeStore>>['store'], site: JiraSite, jql?: string): Promise<void> {
  console.log(`› Jira "${site.baseUrl}": reading tickets (read-only)…`);
  const issues = await fetchAllIssues(site, jql, (n) => process.stdout.write(`\r  fetched ${n} tickets…`));
  process.stdout.write('\n');
  for (const t of issues) {
    const body = [`# ${t.key}: ${t.summary}`, `Type: ${t.type} · Status: ${t.status} · Priority: ${t.priority}${t.labels.length ? ` · Labels: ${t.labels.join(', ')}` : ''}`, '', t.description, ...(t.comments.length ? ['', '## Comments', ...t.comments] : [])].join('\n');
    await store(`${t.key} — ${t.summary}`, body, `jira://${t.key}`, 'jira');
  }
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const projectName = arg('project');
  if (!projectName) throw new Error('--project "<name>" is required.');
  const githubOrg = arg('github-org');
  const docsRepo = arg('docs-repo');
  const jiraUrl = arg('jira');
  if (!githubOrg && !jiraUrl) throw new Error('Provide at least one source: --github-org and/or --jira.');

  const config = getConfig();
  const repos = createPostgresRepositories(databaseUrl);
  const sanitizer = createSanitizer(config);
  const dense = embeddingsEnabled(config);

  // Resolve the target project by name (reuse if it exists), else create it.
  const existing = (await repos.projects.list()).find((p) => p.name.toLowerCase() === projectName.toLowerCase());
  const projectId: ProjectId = existing?.id ?? newProjectId();
  if (!existing) await repos.projects.upsert(Project.parse({ id: projectId, name: projectName, classification: 'confidential', description: `Context ingested read-only from ${[githubOrg && 'GitHub', jiraUrl && 'Jira'].filter(Boolean).join(' + ')}.`, createdAt: nowIso() }));

  // Refresh: drop existing knowledge so re-runs don't duplicate.
  for (const doc of await repos.knowledge.listDocuments(projectId)) await repos.knowledge.deleteDocument(projectId, doc.id);

  const { store, stats } = makeStore(repos, sanitizer, projectId, dense);
  if (githubOrg) await ingestGitHub(store, githubOrg, docsRepo);
  if (jiraUrl) {
    const email = arg('jira-email');
    const tokenEnv = arg('jira-token-env');
    const token = tokenEnv ? process.env[tokenEnv] : undefined;
    if (!email || !token) throw new Error('--jira needs --jira-email and --jira-token-env <ENV_VAR> (token read from that env var).');
    await ingestJira(store, { baseUrl: jiraUrl, email, token }, arg('jira-jql'));
  }

  await repos.close();
  const { docs, chunks } = stats();
  console.log(`\n✓ "${projectName}" context ingested (read-only): ${docs} documents, ${chunks} chunks${dense ? ' (with embeddings)' : ''}.`);
}

main().catch((e) => {
  console.error('Ingestion failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
