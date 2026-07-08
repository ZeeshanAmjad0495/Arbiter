/**
 * End-to-end flow coverage over the real HTTP server (offline engine, no external
 * services) driven by the Zuub test corpus. Exercises every Arbiter surface a user
 * touches — auth, projects, knowledge (RAG), concept graph (GraphRAG), the full
 * guardrail generation pipeline, schema validation, the test runner, gated write-back,
 * de-mask, metrics and reviews — plus the cross-tenant isolation guarantee.
 *
 * This doubles as the seed of the CI E2E suite: it boots buildServer() exactly as
 * production does and asserts the product invariants (grounded, gated, redacted,
 * audited, read-only-by-default) hold on realistic data.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '@arbiter/config';
import { Project, User, newProjectId, newUserId, nowIso } from '@arbiter/core';
import { createGuardrailEngine } from '@arbiter/guardrail';
import { AuthService } from '../apps/api/src/auth';
import { buildServer } from '../apps/api/src/server';
import { ZUUB_TICKETS, ZUUB_CLAIM_SCHEMA, ZUUB_CLAIM_VALID, ZUUB_CLAIM_INVALID } from './fixtures/zuub-tickets';

type Injected = Awaited<ReturnType<ReturnType<typeof buildServer>['inject']>>;

let app: ReturnType<typeof buildServer>;
let engine: ReturnType<typeof createGuardrailEngine>;
let auth: AuthService;
let zuubProjectId: ReturnType<typeof newProjectId>;
let otherProjectId: ReturnType<typeof newProjectId>;
const tok: Record<string, string> = {};

async function login(email: string, role: 'admin' | 'qa' | 'qa_lead'): Promise<string> {
  const { key } = await auth.issueKey(email, role);
  const res = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, key } });
  return res.json().token as string;
}

function req(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  url: string,
  opts: { token?: string; body?: unknown; project?: string } = {},
): Promise<Injected> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.project) headers['x-arbiter-project'] = opts.project;
  return app.inject({ method, url, headers, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
}

beforeAll(async () => {
  engine = createGuardrailEngine({ config: loadConfig({}) });
  zuubProjectId = newProjectId();
  otherProjectId = newProjectId();
  const actorId = newUserId();
  await engine.repos.projects.upsert(Project.parse({ id: zuubProjectId, name: 'Zuub', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.projects.upsert(Project.parse({ id: otherProjectId, name: 'Other', classification: 'internal', createdAt: nowIso() }));
  await engine.repos.users.upsert(User.parse({ id: actorId, email: 'system@zuub.test', role: 'qa', createdAt: nowIso() }));
  auth = new AuthService(engine.repos, 3_600_000);
  app = buildServer({ engine, defaultProjectId: zuubProjectId, defaultActorId: actorId, auth, logger: false });
  await app.ready();
  tok.admin = await login('admin@zuub.test', 'admin');
  tok.lead = await login('lead@zuub.test', 'qa_lead');
  tok.qa = await login('qa@zuub.test', 'qa');
});

afterAll(async () => {
  await app.close();
});

describe('Zuub E2E · auth & session', () => {
  it('issues a key, logs in, and identifies the user', async () => {
    const me = await req('GET', '/v1/auth/me', { token: tok.admin });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('admin@zuub.test');
    expect(me.json().user.role).toBe('admin');
  });

  it('rejects an unauthenticated request to a protected route', async () => {
    expect((await req('GET', '/v1/knowledge')).statusCode).toBe(401);
  });
});

describe('Zuub E2E · knowledge ingestion (the corpus)', () => {
  it('ingests all 12 Zuub tickets as project knowledge', async () => {
    for (const t of ZUUB_TICKETS) {
      const res = await req('POST', '/v1/knowledge', {
        token: tok.admin,
        body: { title: `${t.key} — ${t.title}`, content: t.content, sourceType: 'jira', classification: 'internal' },
      });
      expect([200, 201]).toContain(res.statusCode);
    }
    const list = await req('GET', '/v1/knowledge', { token: tok.admin });
    expect(list.statusCode).toBe(200);
    const docs = list.json().documents ?? list.json().knowledge ?? [];
    expect(docs.length).toBeGreaterThanOrEqual(ZUUB_TICKETS.length);
  });
});

describe('Zuub E2E · concept graph (GraphRAG) + extraction reliability', () => {
  let labels: string[] = [];

  it('builds a graph that surfaces real Zuub entities', async () => {
    const built = await req('POST', '/v1/graph/build', { token: tok.admin });
    expect(built.statusCode).toBe(200);
    expect(built.json().built.nodes).toBeGreaterThan(0);

    const g = await req('GET', '/v1/graph', { token: tok.admin });
    labels = g.json().nodes.map((n: { label: string }) => n.label);
    // Domain fields and endpoints are extracted deterministically from ticket bodies.
    expect(labels).toContain('member_id');
    expect(labels).toContain('coverage_status');
    expect(labels.some((l) => l.startsWith('/v1/'))).toBe(true);
  });

  it('does not surface stop-word / boilerplate noise as concept nodes', () => {
    for (const noise of ['This', 'These', 'When', 'Status', 'Priority', 'Comments', 'Summary', 'Description']) {
      expect(labels).not.toContain(noise);
    }
  });
});

describe('Zuub E2E · guardrail pipeline over every ticket', () => {
  it('runs each ticket through sanitize → ground → generate → validate → gate with the right outcome', async () => {
    let redactedSomewhere = false;
    for (const t of ZUUB_TICKETS) {
      const res = await req('POST', `/v1/workflows/${t.workflow}/run`, {
        token: tok.admin,
        body: { requirement: t.content, riskTier: t.riskTier, useKnowledge: true, useGraph: true },
      });
      expect(res.statusCode, `${t.key} run`).toBe(200);
      const b = res.json();
      const actions: string[] = b.audit.map((a: { action: string }) => a.action);

      if (t.expect.credential) {
        // A live secret must hard-block BEFORE the model call — no output, no generate.
        expect(b.sanitization.blocked, `${t.key} blocked`).toBe(true);
        expect(b.output, `${t.key} output`).toBeNull();
        expect(b.review.decision).toBe('rejected');
        expect(actions).not.toContain('generate');
      } else {
        expect(b.sanitization.blocked, `${t.key} not blocked`).toBe(false);
        expect(b.output, `${t.key} output`).not.toBeNull();
        expect(['approved', 'pending', 'needs_changes']).toContain(b.review.decision);
        // Full pipeline ran and is audited.
        for (const stage of ['sanitize', 'ground', 'generate', 'validate', 'gate.decision']) {
          expect(actions, `${t.key} ${stage}`).toContain(stage);
        }
        expect(typeof b.grounding.violations).toBe('number');
        // High-risk drafts are never auto-approved — they wait for a human.
        if (t.riskTier === 'high') expect(['pending', 'needs_changes']).toContain(b.review.decision);
      }

      if (t.expect.pii) {
        expect(b.sanitization.findings.length, `${t.key} findings`).toBeGreaterThan(0);
        expect(b.sanitization.sanitizedText).not.toContain('gabriel.newton@example.com');
        expect(b.sanitization.sanitizedText).not.toContain('415-555-0148');
      }
      if (b.sanitization.findings.length > 0) redactedSomewhere = true;
    }
    expect(redactedSomewhere).toBe(true);
  });
});

describe('Zuub E2E · data format checker (schema validation)', () => {
  let schemaId: string;
  it('saves a Zuub claim schema', async () => {
    const res = await req('POST', '/v1/schemas', { token: tok.admin, body: { name: 'Zuub claim', schema: ZUUB_CLAIM_SCHEMA } });
    expect(res.statusCode).toBe(201);
    schemaId = res.json().schema.id;
  });
  it('passes a conforming claim and fails a malformed one without echoing PII', async () => {
    const ok = await req('POST', `/v1/schemas/${schemaId}/validate`, { token: tok.admin, body: { data: ZUUB_CLAIM_VALID } });
    expect(ok.json()).toEqual({ valid: true, errors: [] });

    const bad = await req('POST', `/v1/schemas/${schemaId}/validate`, { token: tok.admin, body: { data: ZUUB_CLAIM_INVALID } });
    expect(bad.json().valid).toBe(false);
    expect(bad.json().errors.length).toBeGreaterThan(0);
    // The offending SSN value must never appear in the error report.
    expect(JSON.stringify(bad.json().errors)).not.toContain('000-00-0000');
  });
});

describe('Zuub E2E · test runner (executions)', () => {
  it('runs an authored test and records a normalized result', async () => {
    const res = await req('POST', '/v1/executions', {
      token: tok.admin,
      body: { kind: 'playwright', name: 'Zuub IV smoke', script: "test('eligibility', async () => { expect(true).toBe(true); });" },
    });
    expect(res.statusCode).toBe(200);
    const ex = res.json().execution;
    expect(['passed', 'failed', 'error']).toContain(ex.status);
    expect(Array.isArray(ex.cases)).toBe(true);
  });
});

describe('Zuub E2E · gated write-back (the only write path)', () => {
  it('targets the sandbox and applies an approved issue', async () => {
    const target = await req('GET', '/v1/writeback/target', { token: tok.lead });
    expect(target.json().id).toBe('sandbox');
    expect(target.json().live).toBe(false);

    const t = ZUUB_TICKETS[0]!;
    const res = await req('POST', '/v1/writeback/apply', {
      token: tok.lead,
      body: { resource: 'issue', action: 'create', summary: t.title, payload: { title: t.title, body: t.content, labels: ['zuub', 'e2e'] }, approver: 'lead@zuub.test' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({ applied: true, verified: true });
  });

  it('forbids a plain QA from writing back', async () => {
    const res = await req('POST', '/v1/writeback/apply', {
      token: tok.qa,
      body: { resource: 'issue', action: 'create', summary: 'x', payload: { title: 'x' }, approver: 'qa@zuub.test' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('Zuub E2E · de-mask (admin PII sink, tenant-scoped)', () => {
  it('rehydrates a placeholder within its project but never across projects', async () => {
    // Run the PII ticket so its email/phone get placeholdered and mapped to THIS project.
    const pii = ZUUB_TICKETS.find((t) => t.expect.pii)!;
    const run = await req('POST', `/v1/workflows/${pii.workflow}/run`, { token: tok.admin, body: { requirement: pii.content } });
    const sanitized: string = run.json().sanitization.sanitizedText;
    const placeholder = sanitized.match(/\[[A-Z0-9_]+_\d+\]/)?.[0];
    expect(placeholder, 'a placeholder was produced').toBeTruthy();

    const here = await req('POST', '/v1/demask/resolve', { token: tok.admin, body: { text: sanitized } });
    expect(here.statusCode).toBe(200);
    expect(here.json().resolved).toBeGreaterThan(0);
    expect(here.json().text).toContain('gabriel.newton@example.com');

    // The SAME placeholder resolves to nothing in a different project (isolation).
    const there = await req('POST', '/v1/demask/resolve', { token: tok.admin, project: otherProjectId, body: { text: placeholder! } });
    expect(there.json().resolved).toBe(0);
    expect(there.json().text).toBe(placeholder);
  });

  it('forbids a non-admin from de-masking', async () => {
    expect((await req('POST', '/v1/demask/resolve', { token: tok.lead, body: { text: '[EMAIL_ADDRESS_1]' } })).statusCode).toBe(403);
  });
});

describe('Zuub E2E · insights & reviews', () => {
  it('computes quality metrics after the runs', async () => {
    const res = await req('GET', '/v1/metrics', { token: tok.admin });
    expect(res.statusCode).toBe(200);
    // The corpus runs produced artifacts, reviews and grounding events.
    expect(res.json().metrics.totals.artifacts).toBeGreaterThan(0);
    expect(res.json().metrics.grounding.validated).toBeGreaterThan(0);
  });
  it('serves the review queue', async () => {
    const res = await req('GET', '/v1/reviews', { token: tok.admin });
    expect(res.statusCode).toBe(200);
  });
});

describe('Zuub E2E · cross-tenant isolation', () => {
  it("blocks a non-member from another project and keeps its knowledge separate", async () => {
    // A plain QA is not a member of the Other project.
    expect((await req('GET', '/v1/graph', { token: tok.qa, project: otherProjectId })).statusCode).toBe(403);

    // Admin ingests a distinctive field into Other and builds its graph.
    await req('POST', '/v1/knowledge', {
      token: tok.admin,
      project: otherProjectId,
      body: { title: 'Other seed', content: 'The zebra_marker_field is unique to the other tenant.', sourceType: 'paste', classification: 'internal' },
    });
    await req('POST', '/v1/graph/build', { token: tok.admin, project: otherProjectId });

    const other = await req('GET', '/v1/graph', { token: tok.admin, project: otherProjectId });
    const otherLabels = other.json().nodes.map((n: { label: string }) => n.label);
    expect(otherLabels).toContain('zebra_marker_field');

    // The Zuub (default) graph never sees the other tenant's field.
    const zuub = await req('GET', '/v1/graph', { token: tok.admin });
    const zuubLabels = zuub.json().nodes.map((n: { label: string }) => n.label);
    expect(zuubLabels).not.toContain('zebra_marker_field');
  });
});
