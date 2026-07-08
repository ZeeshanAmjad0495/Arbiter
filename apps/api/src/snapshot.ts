import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/**
 * Snapshot-before-delete. Every destructive action writes a compressed, timestamped
 * backup of exactly what it is about to remove — an AWS-snapshot-style safety net so
 * nothing is ever lost irrecoverably. gzip keeps them small; they live under
 * ARBITER_BACKUP_DIR (default ./backups, git-ignored). Built on node:zlib — no dep.
 */
const BACKUP_DIR = process.env.ARBITER_BACKUP_DIR ?? join(process.cwd(), 'backups');

export interface SnapshotRef {
  path: string;
  bytes: number;
  snapshotAt: string;
}

export function writeSnapshot(kind: string, projectId: string, data: unknown): SnapshotRef {
  const dir = join(BACKUP_DIR, kind, projectId);
  mkdirSync(dir, { recursive: true });
  const snapshotAt = new Date().toISOString();
  const gz = gzipSync(Buffer.from(JSON.stringify({ kind, projectId, snapshotAt, data }), 'utf8'));
  const path = join(dir, `${snapshotAt.replace(/[:.]/g, '-')}.json.gz`);
  writeFileSync(path, gz);
  return { path, bytes: gz.length, snapshotAt };
}
