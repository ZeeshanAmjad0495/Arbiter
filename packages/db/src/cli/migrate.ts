import { getConfig } from '@arbiter/config';
import { runMigrations } from '../migrate';

async function main(): Promise<void> {
  const config = getConfig();
  const url = config.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Start Postgres (pnpm docker:up) and set DATABASE_URL, then re-run.');
    process.exitCode = 1;
    return;
  }
  const result = await runMigrations(url);
  if (result.applied.length === 0) {
    console.log(`Database up to date (${result.skipped.length} migrations already applied).`);
  } else {
    console.log(`Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
