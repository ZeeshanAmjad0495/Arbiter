import { getConfig } from '@arbiter/config';
import { createMemoryRepositories } from './memory';
import { createPostgresRepositories } from './postgres';
import type { RepositoryBundle } from './types';

/**
 * Returns the Postgres bundle when DATABASE_URL is set, otherwise the in-memory
 * bundle. Callers depend only on RepositoryBundle, never on which one they got.
 */
export function createRepositories(): RepositoryBundle {
  const config = getConfig();
  if (config.persistence === 'postgres' && config.env.DATABASE_URL) {
    return createPostgresRepositories(config.env.DATABASE_URL);
  }
  return createMemoryRepositories();
}
