/**
 * `pnpm test:llm` — boots the offline Arbiter API in-process on :4344 (stub LLM,
 * in-memory, no keys), then runs the promptfoo LLM-output assertion suite against it
 * and propagates promptfoo's exit code. Deterministic and CI-safe.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfig } from '@arbiter/config';
import { Project, ProjectId, User, UserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { buildServer } from '../../apps/api/src/server';

const PORT = 4344;
const CONFIG = join(dirname(fileURLToPath(import.meta.url)), 'promptfooconfig.yaml');

async function main(): Promise<void> {
  const config = loadConfig({ ARBITER_API_PORT: String(PORT) });
  const engine = createGuardrailEngine({ config });
  const projectId = ProjectId.parse('00000000-0000-4000-8000-000000000001');
  const actorId = UserId.parse('00000000-0000-4000-8000-000000000002');
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'llm-test', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'qa@arbiter.local', role: 'qa', createdAt: nowIso() }));
  // No auth → the promptfoo http provider can POST without a token.
  const app = buildServer({ engine, defaultProjectId: projectId, defaultActorId: actorId, logger: false });
  await app.listen({ port: PORT, host: '127.0.0.1' });

  // Async spawn (NOT spawnSync): promptfoo POSTs back to this in-process server, so the
  // event loop must stay free to answer those requests — spawnSync would deadlock it.
  const code = await new Promise<number>((resolve) => {
    const child = spawn('pnpm', ['exec', 'promptfoo', 'eval', '-c', CONFIG, '--no-cache'], {
      stdio: 'inherit',
      // No phone-home: telemetry / update / share checks would hang a sandboxed CI runner.
      env: { ...process.env, PROMPTFOO_DISABLE_TELEMETRY: '1', PROMPTFOO_DISABLE_UPDATE: '1', PROMPTFOO_DISABLE_SHARING: '1' },
    });
    child.on('close', (c) => resolve(c ?? 1));
    child.on('error', () => resolve(1));
  });
  await app.close();
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
