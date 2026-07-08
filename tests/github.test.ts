import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { type ProjectId, type UserId, newProjectId, newUserId } from '@arbiter/core';
import { GitHubWriteTarget, SandboxWriteTarget, WriteGate, type WritePlan, writeTargetFor } from '@arbiter/guardrail';

function fakeFetch(responses: Response[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return responses[Math.min(i++, responses.length - 1)]!;
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const createPlan: WritePlan = {
  targetId: 'github',
  resource: 'issue',
  action: 'create',
  summary: 'Flaky test: checkout total intermittently off-by-one',
  payload: { title: 'Flaky: checkout total', body: 'Repro: run 20×, ~2 fail.', labels: ['flaky', 'qa'] },
};

describe('GitHubWriteTarget (real WriteGate target)', () => {
  it('creates an issue with the right URL, auth, and body; returns the html_url', async () => {
    const { fn, calls } = fakeFetch([jsonRes({ number: 42, html_url: 'https://github.com/acme/app/issues/42' }, 201)]);
    const target = new GitHubWriteTarget({ token: 'ghp_secret', owner: 'acme', repo: 'app', fetchImpl: fn });

    const { reference } = await target.apply(createPlan);
    expect(reference).toBe('https://github.com/acme/app/issues/42');

    const call = calls[0]!;
    expect(call.url).toBe('https://api.github.com/repos/acme/app/issues');
    expect(call.init?.method).toBe('POST');
    expect((call.init?.headers as Record<string, string>).authorization).toBe('Bearer ghp_secret');
    const sent = JSON.parse(call.init!.body as string);
    expect(sent).toMatchObject({ title: 'Flaky: checkout total', labels: ['flaky', 'qa'] });
  });

  it('comments on an issue when action=comment', async () => {
    const { fn, calls } = fakeFetch([jsonRes({ id: 7, html_url: 'https://github.com/acme/app/issues/42#issuecomment-7' })]);
    const target = new GitHubWriteTarget({ token: 't', owner: 'acme', repo: 'app', fetchImpl: fn });
    const ref = await target.apply({ targetId: 'github', resource: 'comment', action: 'comment', summary: 'still flaky', payload: { issueNumber: 42, body: 'reproduced again' } });
    expect(ref.reference).toContain('#issuecomment-7');
    expect(calls[0]!.url).toBe('https://api.github.com/repos/acme/app/issues/42/comments');
  });

  it('throws on a non-2xx response and verifies via a follow-up GET', async () => {
    const err = new GitHubWriteTarget({ token: 't', owner: 'a', repo: 'r', fetchImpl: fakeFetch([jsonRes({ message: 'Bad credentials' }, 401)]).fn });
    await expect(err.apply(createPlan)).rejects.toThrow(/github_error_401/);

    const ok = new GitHubWriteTarget({ token: 't', owner: 'a', repo: 'r', fetchImpl: fakeFetch([jsonRes({ number: 5 }, 200)]).fn });
    expect(await ok.verify(createPlan, 'https://github.com/a/r/issues/5')).toBe(true);
  });

  it('writeTargetFor falls back to the sandbox when GitHub is unconfigured', () => {
    expect(writeTargetFor(loadConfig({}))).toBeInstanceOf(SandboxWriteTarget);
    const gh = writeTargetFor(loadConfig({ GITHUB_TOKEN: 't', GITHUB_OWNER: 'a', GITHUB_REPO: 'r' }));
    expect(gh).toBeInstanceOf(GitHubWriteTarget);
  });

  it('flows through the WriteGate: named approval → apply → verify → audit', async () => {
    const audited: unknown[] = [];
    const gate = new WriteGate({ append: async (e) => (audited.push(e), e) });
    const target = new GitHubWriteTarget({ token: 't', owner: 'acme', repo: 'app', fetchImpl: fakeFetch([jsonRes({ number: 9, html_url: 'https://github.com/acme/app/issues/9' }, 201), jsonRes({ number: 9 })]).fn });
    gate.register(target);

    const res = await gate.apply({
      projectId: newProjectId() as ProjectId,
      actorId: newUserId() as UserId,
      plan: createPlan,
      approval: { approver: 'jane.qa', approved: true },
    });
    expect(res).toMatchObject({ applied: true, verified: true });
    expect(res.reference).toContain('/issues/9');
    expect(audited).toHaveLength(1);
  });

  it('WriteGate still hard-refuses a Jira-aliased target id', () => {
    const gate = new WriteGate({ append: async (e) => e });
    // A GitHub target is fine; a Jira-id target is refused at register time.
    expect(() => gate.register({ id: 'jira-prod', apply: async () => ({ reference: 'x' }), verify: async () => true })).toThrow(/forbidden_target/);
  });
});
