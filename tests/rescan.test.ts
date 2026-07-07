import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { buildContextPack, createGuardrailEngine } from '@arbiter/guardrail';

/**
 * The output PII re-scan gate: for a rescanOutput workflow, PII in the GENERATED
 * artifact (not just the input) must block export. Drives engine.run directly so
 * we control the stub output.
 */
describe('output PII re-scan gate', () => {
  const Schema = z.object({ rows: z.array(z.string()) });

  async function runWithOutput(rows: string[], rescanOutput: boolean) {
    const engine = createGuardrailEngine({ config: loadConfig({}) });
    const projectId = newProjectId();
    const actorId = newUserId();
    await engine.repos.projects.upsert(Project.parse({ id: projectId, name: 't', classification: 'internal', createdAt: nowIso() }));
    await engine.repos.users.upsert(User.parse({ id: actorId, email: 'a@b.com', role: 'qa', createdAt: nowIso() }));
    return engine.run<{ rows: string[] }>({
      projectId,
      actorId,
      workflow: 'synthetic',
      promptVersion: 'synthetic@v1',
      riskTier: 'low', // low tier would normally auto-pass — so a block proves the gate fired
      rawInput: 'generate synthetic rows',
      system: 'x',
      buildContextPack: () => buildContextPack(projectId, []),
      buildPrompt: () => 'x',
      schema: Schema,
      rescanOutput,
      stub: () => ({ rows }),
    });
  }

  it('blocks export when the generated artifact contains real PII', async () => {
    const outcome = await runWithOutput(['member ssn=123-45-6789, email=jane.doe@example.com'], true);
    expect(outcome.output).not.toBeNull(); // output is preserved, just gated
    expect(outcome.review.decision).toBe('needs_changes');
    const rescan = outcome.audit.find((a) => a.action === 'validate' && a.detail.stage === 'output_pii_rescan');
    expect(rescan).toBeTruthy();
    expect((rescan!.detail.findings as number) > 0).toBe(true);
  });

  it('does not block clean synthetic output', async () => {
    const outcome = await runWithOutput(['member_id=SYN-000001 | name=Persona-A | points_balance=120'], true);
    expect(outcome.review.decision).not.toBe('needs_changes');
  });

  it('leaves PII-shaped output alone when re-scan is off (opt-in only)', async () => {
    const outcome = await runWithOutput(['ssn=123-45-6789'], false);
    // low tier + no grounding claims + no re-scan → auto-passes
    expect(outcome.review.decision).not.toBe('needs_changes');
  });
});
