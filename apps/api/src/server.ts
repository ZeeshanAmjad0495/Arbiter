import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getConfig } from '@arbiter/config';
import { AuditEvent, ReviewLog, newAuditEventId, newReviewLogId, nowIso, unifiedDiff } from '@arbiter/core';
import type { ArtifactId, ProjectId, UserId } from '@arbiter/core';
import type { GuardrailEngine } from '@arbiter/guardrail';
import { InMemoryTracer, renderTrace } from '@arbiter/telemetry';
import { getWorkflow, listPromptTemplates, listWorkflowsMeta, runWorkflow } from '@arbiter/workflows';
import { fetchJiraIssue } from './jira';

const ReviewBody = z.object({
  decision: z.enum(['approved', 'rejected', 'needs_changes']),
  editedContent: z.unknown().optional(),
  dwellMs: z.number().int().nonnegative().optional(),
});

/** Derive a human-readable title for the review queue from arbitrary output. */
function summaryOf(content: unknown): string {
  if (content && typeof content === 'object') {
    const o = content as Record<string, unknown>;
    if (typeof o.title === 'string') return o.title;
    if (typeof o.summary === 'string') return o.summary;
    const firstStr = Object.values(o).find((v) => typeof v === 'string');
    if (typeof firstStr === 'string') return firstStr;
  }
  return '(untitled artifact)';
}

const RunBody = z.object({
  requirement: z.string().min(1, 'requirement is required'),
  context: z
    .array(
      z.object({
        title: z.string().default('context'),
        content: z.string().min(1),
        sourceType: z.enum(['jira', 'confluence', 'openapi', 'schema', 'repo', 'upload', 'paste', 'other']).optional(),
      }),
    )
    .default([]),
  riskTier: z.enum(['low', 'medium', 'high']).optional(),
  autoApprove: z.boolean().default(false),
  simulateHallucination: z.boolean().default(false),
});

export interface ServerDeps {
  readonly engine: GuardrailEngine;
  readonly demoProjectId: ProjectId;
  readonly demoActorId: UserId;
  readonly webDir?: string;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: true });
  const config = getConfig();

  const modes = {
    persistence: config.persistence,
    sanitizer: config.sanitizer,
    llm: config.llm,
    telemetry: config.telemetry,
    demask: config.demask,
  };

  app.get('/health', async () => ({ status: 'ok', modes }));
  app.get('/api/status', async () => ({ modes, models: config.models, integrations: { jira: config.jira.configured } }));

  // Read-only Jira fetch-by-ticket-key (grounding pull-forward).
  app.get<{ Params: { key: string } }>('/v1/jira/:key', async (request, reply) => {
    if (!config.jira.configured) {
      return reply
        .status(501)
        .send({ error: 'jira_not_configured', message: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env to enable Jira fetch.' });
    }
    try {
      return reply.send({ context: await fetchJiraIssue(request.params.key) });
    } catch (e) {
      return reply.status(502).send({ error: 'jira_fetch_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  // List available workflows (for the UI switcher).
  app.get('/v1/workflows', async () => ({ workflows: listWorkflowsMeta() }));

  // Prompt library — the versioned 6-component templates (seeded from A1–A8).
  app.get('/v1/prompts', async () => {
    const labels = new Map(listWorkflowsMeta().map((m) => [m.id, m.label]));
    return { prompts: listPromptTemplates().map((t) => ({ ...t, label: labels.get(t.id) ?? t.id })) };
  });

  // Run any workflow through the guardrail pipeline.
  app.post<{ Params: { id: string } }>('/v1/workflows/:id/run', async (request, reply) => {
    const def = getWorkflow(request.params.id);
    if (!def) return reply.status(404).send({ error: 'unknown_workflow', id: request.params.id });

    const parsed = RunBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const body = parsed.data;

    // Fresh tracer per request so the UI shows exactly this run's trace.
    const tracer = new InMemoryTracer();
    const outcome = await runWorkflow(
      deps.engine,
      def,
      {
        projectId: deps.demoProjectId,
        actorId: deps.demoActorId,
        requirement: body.requirement,
        context: body.context,
        ...(body.riskTier ? { riskTier: body.riskTier } : {}),
        autoApprove: body.autoApprove,
        simulateHallucination: body.simulateHallucination,
      },
      { tracer },
    );

    const root = tracer.roots[0];
    return reply.send({
      workflow: def.id,
      outputView: def.ui.outputView,
      runId: outcome.runId,
      model: outcome.model,
      sanitization: {
        engine: outcome.sanitization.engine,
        blocked: outcome.sanitization.blocked,
        blockReasons: outcome.sanitization.blockReasons,
        sanitizedText: outcome.sanitization.sanitizedText,
        findings: outcome.sanitization.findings,
      },
      contextPack: outcome.contextPack.items.map((i) => ({
        id: i.id,
        title: i.title,
        citation: i.citation,
        classification: i.classification,
        syncedAt: i.syncedAt ?? null,
      })),
      output: outcome.output,
      grounding: outcome.grounding,
      review: outcome.review,
      audit: outcome.audit.map((a) => ({ action: a.action, at: a.createdAt, detail: a.detail })),
      trace: root ? { text: renderTrace(root), tree: root } : null,
    });
  });

  // ----- Review queue -----
  app.get('/v1/reviews', async () => {
    const pending = await deps.engine.repos.artifacts.listByStatus(deps.demoProjectId, ['in_review']);
    return {
      reviews: pending.map((a) => ({
        id: a.id,
        type: a.type,
        riskTier: a.riskTier,
        status: a.status,
        model: a.model ?? null,
        createdAt: a.createdAt,
        summary: summaryOf(a.content),
      })),
    };
  });

  app.get<{ Params: { id: string } }>('/v1/artifacts/:id', async (request, reply) => {
    const artifact = await deps.engine.repos.artifacts.get(deps.demoProjectId, request.params.id as ArtifactId);
    if (!artifact) return reply.status(404).send({ error: 'not_found' });
    const reviews = await deps.engine.repos.reviews.listByArtifact(deps.demoProjectId, artifact.id);
    return { artifact, reviews };
  });

  app.post<{ Params: { id: string } }>('/v1/artifacts/:id/review', async (request, reply) => {
    const parsed = ReviewBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { decision, editedContent, dwellMs } = parsed.data;

    const artifact = await deps.engine.repos.artifacts.get(deps.demoProjectId, request.params.id as ArtifactId);
    if (!artifact) return reply.status(404).send({ error: 'not_found' });

    const statusFor = { approved: 'approved', rejected: 'rejected', needs_changes: 'in_review' } as const;

    // Capture the reviewer's edit-diff — the flywheel signal.
    let editDiff: string | undefined;
    let contentPatch: unknown | undefined;
    if (editedContent !== undefined) {
      const before = JSON.stringify(artifact.content, null, 2);
      const after = JSON.stringify(editedContent, null, 2);
      if (before !== after) {
        editDiff = unifiedDiff(before, after);
        contentPatch = editedContent;
      }
    }

    const updated = await deps.engine.repos.artifacts.update(deps.demoProjectId, artifact.id, {
      status: statusFor[decision],
      ...(contentPatch !== undefined ? { content: contentPatch } : {}),
    });

    const now = nowIso();
    const review = ReviewLog.parse({
      id: newReviewLogId(),
      projectId: deps.demoProjectId,
      artifactId: artifact.id,
      decision,
      mode: 'pre_approval',
      riskTier: artifact.riskTier,
      reviewer: deps.demoActorId,
      ...(editDiff ? { editDiff } : {}),
      ...(dwellMs !== undefined ? { dwellMs } : {}),
      decidedAt: now,
      createdAt: now,
    });
    await deps.engine.repos.reviews.append(review);

    await deps.engine.repos.audit.append(
      AuditEvent.parse({
        id: newAuditEventId(),
        projectId: deps.demoProjectId,
        actorId: deps.demoActorId,
        workflowRunId: artifact.workflowRunId,
        action: 'gate.decision',
        sources: [],
        detail: { decision, source: 'human_review', edited: editDiff !== undefined },
        createdAt: now,
      }),
    );

    return reply.send({ artifact: updated, review });
  });

  // Serve the built SvelteKit SPA in prod; in dev the Vite server proxies here.
  const webDir = deps.webDir ?? fileURLToPath(new URL('../../web/build', import.meta.url));
  if (existsSync(webDir)) {
    app.register(fastifyStatic, { root: webDir, prefix: '/' });
  } else {
    app.log.info(`web build not found at ${webDir} — running API-only (use the Vite dev server for the UI)`);
  }

  return app;
}
