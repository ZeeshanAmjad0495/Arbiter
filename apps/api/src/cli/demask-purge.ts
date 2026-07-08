/**
 * De-mask retention scheduler. Purges de-mask mappings older than a cutoff from the
 * durable (Postgres) vault, taking a compressed backup snapshot of exactly what it
 * removes first (recoverable). Meant to be run on a schedule so retention is enforced
 * automatically without anyone clicking Purge.
 *
 * Run:  DATABASE_URL=… pnpm demask:purge [--days 30] [--project "<name|id>"]
 * Cron: 0 3 * * *  cd /path/to/arbiter && DATABASE_URL=… pnpm demask:purge --days 30
 */
import { type ProjectId, ProjectId as ProjectIdSchema } from '@arbiter/core';
import { createPostgresRepositories } from '@arbiter/db';
import { writeSnapshot } from '../snapshot';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required (retention runs against the durable Postgres vault).');
  const days = Number(arg('days') ?? 30);
  if (!Number.isFinite(days) || days <= 0) throw new Error('--days must be a positive number.');
  const cutoffMs = Date.now() - days * 24 * 3600 * 1000;

  const repos = createPostgresRepositories(databaseUrl);

  // Resolve target projects: --project (name or id), or every project.
  const projectArg = arg('project');
  const allProjects = await repos.projects.list();
  const targets: ProjectId[] = projectArg
    ? [(ProjectIdSchema.safeParse(projectArg).success ? projectArg : allProjects.find((p) => p.name.toLowerCase() === projectArg.toLowerCase())?.id) as ProjectId].filter(Boolean)
    : allProjects.map((p) => p.id);
  if (targets.length === 0) throw new Error(`No matching project for "${projectArg}".`);

  let totalRemoved = 0;
  for (const projectId of targets) {
    const rows = await repos.demask.exportOlderThan(projectId, cutoffMs);
    if (rows.length === 0) continue;
    // Backup the (encrypted) ciphertext before deleting — never plaintext.
    writeSnapshot('demask', projectId, rows.map((r) => ({ placeholder: r.placeholder, type: r.type, cipherB64: Buffer.from(r.cipher).toString('base64'), createdAtMs: r.createdAtMs })));
    const removed = await repos.demask.purgeOlderThan(projectId, cutoffMs);
    totalRemoved += removed;
    console.log(`  project ${projectId}: removed ${removed} mapping(s) older than ${days}d (backed up first)`);
  }

  await repos.close();
  console.log(`✓ Retention purge complete: ${totalRemoved} mapping(s) removed across ${targets.length} project(s).`);
}

main().catch((e) => {
  console.error('Retention purge failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
