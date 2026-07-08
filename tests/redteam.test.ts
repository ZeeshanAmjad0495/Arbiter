import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { createSanitizer } from '@arbiter/sanitize';
import { RED_TEAM_PROBES, runRedTeam } from '@arbiter/workflows';

async function engineWithProject() {
  const engine = createGuardrailEngine({ config: loadConfig({}) });
  const projectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 'rt', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'rt@x.com', role: 'qa', createdAt: nowIso() }));
  return { engine, projectId, actorId };
}

describe('red-team eval harness (garak/PyRIT/Ragas methodology)', () => {
  it('every HARD guardrail defense holds against the probe suite', async () => {
    const { engine, projectId, actorId } = await engineWithProject();
    const report = await runRedTeam(engine, { projectId, actorId });
    await engine.repos.close();

    expect(report.total).toBe(RED_TEAM_PROBES.length);
    // The gate value — no PII/credential/invented-citation may slip through.
    expect(report.hardDefenseRate).toBe(1);
    for (const r of report.results.filter((x) => x.hard)) {
      expect(r.defended, `hard probe ${r.id} breached: ${r.detail}`).toBe(true);
    }
    // Every attack category is represented.
    expect(new Set(report.byCategory.map((c) => c.category)).size).toBeGreaterThanOrEqual(5);
  });

  it('regression: a Stripe-style secret (sk_live_…) hard-blocks (found by the harness)', async () => {
    const sanitizer = createSanitizer(loadConfig({}));
    // Assembled at runtime — no contiguous secret literal in source (push protection).
    const key = ['sk', 'live', '9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c'].join('_');
    const report = await sanitizer.sanitize(`deploy key ${key} please`);
    expect(report.blocked).toBe(true);
    expect(report.sanitizedText).not.toContain(key);
  });
});
