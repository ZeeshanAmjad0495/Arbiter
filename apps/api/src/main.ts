import { getConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { buildServer } from './server';

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

  // Phase 0: a single demo tenant is provisioned at boot. Real auth + project
  // provisioning arrive in Phase 1 (Google SSO + project admin).
  const now = nowIso();
  const project = Project.parse({ id: newProjectId(), name: 'Demo Project', classification: 'confidential', createdAt: now });
  const actor = User.parse({ id: newUserId(), email: 'qa@arbisoft.com', role: 'qa', createdAt: now });
  await engine.repos.projects.upsert(project);
  await engine.repos.users.upsert(actor);

  const app = buildServer({ engine, demoProjectId: project.id, demoActorId: actor.id });

  const port = config.env.ARBITER_API_PORT;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Arbiter API listening on :${port} (persistence=${config.persistence}, llm=${config.llm})`);
}

main().catch((error) => {
  console.error('API failed to start:', error);
  process.exitCode = 1;
});
