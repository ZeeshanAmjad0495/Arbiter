/**
 * Read-only Zuub context ingestion.
 *
 * Pulls a curated, high-signal context from the Zuub GitHub org — repo inventory,
 * the engineering `documentation` repo, and per-repo READMEs — into a dedicated,
 * RLS-isolated "Zuub" project's knowledge store. STRICTLY READ-ONLY against GitHub
 * (every call goes through @arbiter's github-read connector, which cannot mutate).
 * Every document is SANITIZED before storage, so no secret/PII is ever persisted.
 *
 * Refreshable: it clears the project's existing knowledge first, then re-ingests.
 *
 * Run:  DATABASE_URL=… pnpm ingest:zuub
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { getConfig } from '@arbiter/config';
import { KnowledgeDocument, Project, ProjectId, newKnowledgeDocId, nowIso } from '@arbiter/core';
import { createPostgresRepositories } from '@arbiter/db';
import { buildChunks, embedTexts, embeddingsEnabled } from '@arbiter/guardrail';
import { createSanitizer } from '@arbiter/sanitize';
import { ghReadRaw, listOrgRepos, readRepoReadme, repoDefaultBranch } from '../github-read';

const execFileP = promisify(execFile);
const ORG = 'zuub';
// Stable id so re-runs target the same project (and the UI keeps its selection).
const ZUUB = ProjectId.parse('2b11b000-0000-4000-8000-00000000d00c');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (Zuub context needs the durable, RLS-isolated store).');
  const config = getConfig();
  const repos = createPostgresRepositories(databaseUrl);
  const sanitizer = createSanitizer(config);
  const dense = embeddingsEnabled(config);

  await repos.projects.upsert(Project.parse({ id: ZUUB, name: 'Zuub', classification: 'confidential', description: 'Dental-tech platform — context ingested read-only from GitHub (+ Jira).', createdAt: nowIso() }));

  // Refresh: drop the project's existing knowledge so re-runs don't duplicate.
  for (const doc of await repos.knowledge.listDocuments(ZUUB)) await repos.knowledge.deleteDocument(ZUUB, doc.id);

  let docs = 0;
  let chunks = 0;
  const store = async (title: string, content: string): Promise<void> => {
    const safe = (await sanitizer.sanitize(content, ZUUB)).sanitizedText;
    if (!safe.trim()) return;
    const docId = newKnowledgeDocId();
    const built = buildChunks(ZUUB, docId, safe);
    await repos.knowledge.addDocument(
      KnowledgeDocument.parse({ id: docId, projectId: ZUUB, title: title.slice(0, 200), sourceType: 'repo', citation: `github://${ORG}/${title}`, classification: 'confidential', createdAt: nowIso() }),
      built,
    );
    if (dense && built.length) {
      const vecs = await embedTexts(built.map((c) => c.content));
      await Promise.all(built.map((c, i) => (vecs[i] ? repos.knowledge.setChunkEmbedding(ZUUB, c.id, vecs[i]!) : Promise.resolve())));
    }
    docs += 1;
    chunks += built.length;
  };

  // 1) Repo inventory — one overview document.
  console.log('› reading repo inventory (read-only)…');
  const allRepos = (await listOrgRepos(ORG)).filter((r) => !r.archived);
  const inventory = [
    `# Zuub GitHub repositories (${allRepos.length})`,
    '',
    ...allRepos
      .sort((a, b) => (b.updated_at < a.updated_at ? -1 : 1))
      .map((r) => `- **${r.name}** (${r.language ?? 'n/a'}) — ${r.description ?? 'no description'}${r.topics?.length ? ` · topics: ${r.topics.join(', ')}` : ''}`),
  ].join('\n');
  await store('Repository inventory', inventory);

  // 2) The engineering documentation repo — pulled as ONE read-only tarball, then
  //    extracted locally (far fewer API calls than per-file fetching).
  console.log('› reading documentation repo (read-only tarball)…');
  const branch = await repoDefaultBranch(ORG, 'documentation');
  const tar = await ghReadRaw(`repos/${ORG}/documentation/tarball/${branch}`);
  const dir = await mkdtemp(join(tmpdir(), 'zuub-docs-'));
  try {
    const tgz = join(dir, 'docs.tar.gz');
    await writeFile(tgz, tar);
    await execFileP('tar', ['-xzf', tgz, '-C', dir]);
    const roots = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory());
    const root = roots.length ? join(dir, roots[0]!.name) : dir;
    for (const path of await walkMarkdown(root)) {
      const content = await readFile(path, 'utf8');
      if (content.trim()) await store(`docs/${relative(root, path)}`, content);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  // 3) Per-repo READMEs (skip the documentation repo we already covered).
  console.log(`› reading ${allRepos.length} repo READMEs (read-only)…`);
  for (const r of allRepos) {
    if (r.name === 'documentation') continue;
    const readme = await readRepoReadme(ORG, r.name);
    if (readme && readme.trim()) await store(`${r.name}/README`, readme);
  }

  await repos.close();
  console.log(`\n✓ Zuub context ingested (read-only): ${docs} documents, ${chunks} chunks${dense ? ' (with embeddings)' : ''}.`);
}

/** Recursively collect .md file paths under a directory. */
async function walkMarkdown(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue;
      out.push(...(await walkMarkdown(full)));
    } else if (entry.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

main().catch((e) => {
  console.error('Zuub ingestion failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
