import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getConfig } from '@arbiter/config';
import {
  ArtifactId,
  AuditEvent,
  DataClassification,
  KnowledgeDocId,
  KnowledgeDocument,
  Project,
  ProjectId,
  ReviewLog,
  newAuditEventId,
  newKnowledgeDocId,
  newProjectId,
  newReviewLogId,
  nowIso,
  unifiedDiff,
} from '@arbiter/core';
import type { UserId } from '@arbiter/core';
import { type GuardrailEngine, buildChunks, computeQualityMetrics, retrieveKnowledge, toKnowledgeContext } from '@arbiter/guardrail';
import { sanitizeJson } from '@arbiter/sanitize';
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

// Bounded to prevent unauthenticated cost/compute-exhaustion via oversized inputs.
const RunBody = z.object({
  requirement: z.string().min(1, 'requirement is required').max(20_000),
  context: z
    .array(
      z.object({
        title: z.string().max(200).default('context'),
        content: z.string().min(1).max(20_000),
        sourceType: z.enum(['jira', 'confluence', 'openapi', 'schema', 'repo', 'upload', 'paste', 'other']).optional(),
      }),
    )
    .max(20)
    .default([]),
  riskTier: z.enum(['low', 'medium', 'high']).optional(),
  autoApprove: z.boolean().default(false),
  simulateHallucination: z.boolean().default(false),
  /** Pull top-k relevant chunks from the project's knowledge store into context (RAG). */
  useKnowledge: z.boolean().default(false),
});

const KnowledgeBody = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(200_000),
  sourceType: z.enum(['jira', 'confluence', 'openapi', 'schema', 'repo', 'upload', 'paste', 'other']).default('paste'),
  classification: DataClassification.default('internal'),
});

const JIRA_KEY = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

const CreateProjectBody = z.object({
  name: z.string().min(1).max(120),
  classification: DataClassification.default('internal'),
});

export interface ServerDeps {
  readonly engine: GuardrailEngine;
  /** Project used when a request carries no `x-arbiter-project` header (offline/demo default). */
  readonly defaultProjectId: ProjectId;
  /** Single acting user until per-user SSO lands (see Deferred). */
  readonly defaultActorId: UserId;
  readonly webDir?: string;
  /** Defaults to true; tests pass false to keep output readable. */
  readonly logger?: boolean;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });
  const config = getConfig();

  // Minimal auth guard until Google SSO (Phase 1): when ARBITER_API_TOKEN is set,
  // all /v1 and /api routes require `Authorization: Bearer <token>`.
  const apiToken = config.env.ARBITER_API_TOKEN;
  if (apiToken) {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      if (path === '/health' || (!path.startsWith('/v1') && !path.startsWith('/api'))) return;
      if (request.headers.authorization !== `Bearer ${apiToken}`) {
        return reply.status(401).send({ error: 'unauthorized' });
      }
    });
  }

  const modes = {
    persistence: config.persistence,
    sanitizer: config.sanitizer,
    llm: config.llm,
    telemetry: config.telemetry,
    demask: config.demask,
  };

  /**
   * Resolve the acting project from the `x-arbiter-project` header, falling back
   * to the default project when unset. The resolved id is passed to every
   * project-scoped repo call — which is what sets the Postgres RLS GUC per
   * transaction — so a caller can never read/write across the project boundary.
   * (Per-USER authorization of which projects a caller may select arrives with
   * SSO; today the API token trusts the internal caller's project choice.)
   */
  async function resolveProject(request: FastifyRequest, reply: FastifyReply): Promise<ProjectId | null> {
    const header = request.headers['x-arbiter-project'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) return deps.defaultProjectId;
    const parsed = ProjectId.safeParse(raw);
    if (!parsed.success) {
      reply.status(400).send({ error: 'invalid_project_id' });
      return null;
    }
    const project = await deps.engine.repos.projects.get(parsed.data);
    if (!project) {
      reply.status(404).send({ error: 'unknown_project' });
      return null;
    }
    return parsed.data;
  }

  app.get('/health', async () => ({ status: 'ok', modes }));
  app.get('/api/status', async () => ({ modes, models: config.models, integrations: { jira: config.jira.configured } }));

  // ----- Projects (multi-tenant surface) -----
  app.get('/v1/projects', async () => {
    const projects = await deps.engine.repos.projects.list();
    return {
      defaultProjectId: deps.defaultProjectId,
      projects: projects.map((p) => ({ id: p.id, name: p.name, classification: p.classification, createdAt: p.createdAt })),
    };
  });

  app.post('/v1/projects', async (request, reply) => {
    const parsed = CreateProjectBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const project = Project.parse({
      id: newProjectId(),
      name: parsed.data.name,
      classification: parsed.data.classification,
      createdAt: nowIso(),
    });
    await deps.engine.repos.projects.upsert(project);
    return reply.status(201).send({ project });
  });

  // Read-only Jira fetch-by-ticket-key (grounding pull-forward).
  app.get<{ Params: { key: string } }>('/v1/jira/:key', async (request, reply) => {
    if (!config.jira.configured) {
      return reply
        .status(501)
        .send({ error: 'jira_not_configured', message: 'Set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env to enable Jira fetch.' });
    }
    if (!JIRA_KEY.test(request.params.key)) return reply.status(400).send({ error: 'invalid_key' });
    try {
      return reply.send({ context: await fetchJiraIssue(request.params.key) });
    } catch (e) {
      return reply.status(502).send({ error: 'jira_fetch_failed', message: e instanceof Error ? e.message : String(e) });
    }
  });

  app.get('/v1/workflows', async () => ({ workflows: listWorkflowsMeta() }));

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

    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;

    // RAG: pull the most relevant project-knowledge chunks into the context pack
    // so generation is project-aware and cited facts can ground against them.
    let context = body.context;
    if (body.useKnowledge) {
      const retrieved = await retrieveKnowledge(deps.engine.repos, projectId, body.requirement, 4);
      context = [...toKnowledgeContext(retrieved), ...context];
    }

    const tracer = new InMemoryTracer();
    const outcome = await runWorkflow(
      deps.engine,
      def,
      {
        projectId,
        actorId: deps.defaultActorId,
        requirement: body.requirement,
        context,
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

  // ----- Per-project knowledge store (RAG ground source) -----
  app.get('/v1/knowledge', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const docs = await deps.engine.repos.knowledge.listDocuments(projectId);
    return { documents: docs.map((d) => ({ id: d.id, title: d.title, sourceType: d.sourceType, classification: d.classification, createdAt: d.createdAt })) };
  });

  app.post('/v1/knowledge', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const parsed = KnowledgeBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { title, content, sourceType, classification } = parsed.data;
    // Sanitize before storing — knowledge is a ground source, never a PHI sink.
    const safe = (await deps.engine.sanitizer.sanitize(content)).sanitizedText;
    const docId = newKnowledgeDocId();
    const doc = KnowledgeDocument.parse({
      id: docId,
      projectId,
      title,
      sourceType,
      citation: `knowledge://${title.toLowerCase().replace(/\s+/g, '-')}`,
      classification,
      createdAt: nowIso(),
    });
    const chunks = buildChunks(projectId, docId, safe);
    await deps.engine.repos.knowledge.addDocument(doc, chunks);
    return reply.status(201).send({ document: { id: doc.id, title: doc.title, chunks: chunks.length } });
  });

  app.delete<{ Params: { id: string } }>('/v1/knowledge/:id', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const idCheck = KnowledgeDocId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    const ok = await deps.engine.repos.knowledge.deleteDocument(projectId, idCheck.data);
    return ok ? { deleted: true } : reply.status(404).send({ error: 'not_found' });
  });

  // ----- Quality metrics (the project's quality trend line) -----
  app.get('/v1/metrics', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    return { metrics: await computeQualityMetrics(deps.engine.repos, projectId) };
  });

  // ----- Review queue -----
  app.get('/v1/reviews', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const pending = await deps.engine.repos.artifacts.listByStatus(projectId, ['in_review']);
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
    const idCheck = ArtifactId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const artifact = await deps.engine.repos.artifacts.get(projectId, idCheck.data);
    if (!artifact) return reply.status(404).send({ error: 'not_found' });
    const reviews = await deps.engine.repos.reviews.listByArtifact(projectId, artifact.id);
    return { artifact, reviews };
  });

  app.post<{ Params: { id: string } }>('/v1/artifacts/:id/review', async (request, reply) => {
    const idCheck = ArtifactId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    const parsed = ReviewBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { decision, editedContent, dwellMs } = parsed.data;

    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const artifact = await deps.engine.repos.artifacts.get(projectId, idCheck.data);
    if (!artifact) return reply.status(404).send({ error: 'not_found' });

    const statusFor = { approved: 'approved', rejected: 'rejected', needs_changes: 'in_review' } as const;

    // Sanitize reviewer-supplied content BEFORE diffing/persisting — raw PHI a
    // reviewer types in must not land in stored artifacts or the edit-diff.
    let editDiff: string | undefined;
    let contentPatch: unknown | undefined;
    if (editedContent !== undefined) {
      const sanitizedEdit = await sanitizeJson(editedContent, deps.engine.sanitizer);
      const before = JSON.stringify(artifact.content, null, 2);
      const after = JSON.stringify(sanitizedEdit, null, 2);
      if (before !== after) {
        editDiff = unifiedDiff(before, after);
        contentPatch = sanitizedEdit;
      }
    }

    const now = nowIso();
    const review = ReviewLog.parse({
      id: newReviewLogId(),
      projectId,
      artifactId: artifact.id,
      decision,
      mode: 'pre_approval',
      riskTier: artifact.riskTier,
      reviewer: deps.defaultActorId,
      ...(editDiff ? { editDiff } : {}),
      ...(dwellMs !== undefined ? { dwellMs } : {}),
      decidedAt: now,
      createdAt: now,
    });
    const audit = AuditEvent.parse({
      id: newAuditEventId(),
      projectId,
      actorId: deps.defaultActorId,
      workflowRunId: artifact.workflowRunId,
      action: 'gate.decision',
      sources: [],
      detail: { decision, source: 'human_review', edited: editDiff !== undefined },
      createdAt: now,
    });

    // One atomic transaction: status + review + audit commit together.
    const updated = await deps.engine.repos.applyReviewDecision({
      projectId,
      artifactId: artifact.id,
      status: statusFor[decision],
      ...(contentPatch !== undefined ? { content: contentPatch } : {}),
      review,
      audit,
    });

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
