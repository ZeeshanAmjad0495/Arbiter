import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  readonly applied: string[];
  readonly skipped: string[];
}

/**
 * Minimal forward-only migration runner: applies ordered *.sql files in a
 * transaction each, tracking applied versions in schema_migrations. Boring and
 * transparent — no external migration tool to learn or trust.
 */
export async function runMigrations(databaseUrl: string, migrationsDir = MIGRATIONS_DIR): Promise<MigrationResult> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         version    text PRIMARY KEY,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );

    const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
    const { rows } = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const done = new Set(rows.map((r) => r.version));

    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const sql = await readFile(join(migrationsDir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
    return result;
  } finally {
    await client.end();
  }
}
