import { getConfig } from '@arbiter/config';
import { Project, ProjectId, User, UserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { buildServer } from './server';

// Stable ids so restarts are idempotent against a persistent store (a fresh
// random id every boot would orphan prior data and break saved UI selections).
// Additional projects are created at runtime via POST /v1/projects.
const DEFAULT_PROJECT_ID = ProjectId.parse('00000000-0000-4000-8000-000000000001');
const DEFAULT_ACTOR_ID = UserId.parse('00000000-0000-4000-8000-000000000002');

function loadEnv(): void {
  try {
    (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.('.env');
  } catch {
    /* offline defaults apply */
  }
}

async function main(): Promise<void> {
  loadEnv();
  const config = getConfig();
  const engine = createGuardrailEngine();

  // A stable default tenant + acting user are provisioned idempotently at boot;
  // more projects are created at runtime (POST /v1/projects) and selected per
  // request via the `x-arbiter-project` header. Per-user SSO is still deferred.
  const now = nowIso();
  const project = Project.parse({ id: DEFAULT_PROJECT_ID, name: 'Default Project', classification: 'confidential', createdAt: now });
  const actor = User.parse({ id: DEFAULT_ACTOR_ID, email: 'qa@arbisoft.com', role: 'qa', createdAt: now });
  await engine.repos.projects.upsert(project);
  await engine.repos.users.upsert(actor);

  const app = buildServer({ engine, defaultProjectId: project.id, defaultActorId: actor.id });

  const port = config.env.ARBITER_API_PORT;
  const host = config.env.ARBITER_API_HOST;
  await app.listen({ port, host });
  app.log.info(`Arbiter API listening on ${host}:${port} (persistence=${config.persistence}, llm=${config.llm})`);
}

main().catch((error) => {
  console.error('API failed to start:', error);
  process.exitCode = 1;
});
