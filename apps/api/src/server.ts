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
  ProjectSchema,
  ProjectSchemaId,
  ReviewLog,
  newAuditEventId,
  newKnowledgeDocId,
  newProjectId,
  newProjectSchemaId,
  newReviewLogId,
  nowIso,
  toPublicUser,
  unifiedDiff,
} from '@arbiter/core';
import type { UserId } from '@arbiter/core';
import { type GuardrailEngine, buildChunks, buildProjectGraph, computeQualityMetrics, retrieveGraphContext, retrieveKnowledge, toKnowledgeContext } from '@arbiter/guardrail';
import { sanitizeJson } from '@arbiter/sanitize';
import { InMemoryTracer, OtlpHttpExporter, renderTrace } from '@arbiter/telemetry';
import { getWorkflow, listPromptTemplates, listWorkflowsMeta, runWorkflow } from '@arbiter/workflows';
import type { AuthService } from './auth';
import { fetchJiraIssue } from './jira';
import { validateData } from './validate';

/** Request fields set by the auth hook. */
type WithAuth = FastifyRequest & { authUserId?: UserId; authRole?: string };

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
  /** Add graph-aware context (GraphRAG) — connected entities from the project graph. */
  useGraph: z.boolean().default(false),
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
  description: z.string().max(4000).optional(),
  repoUrl: z.string().max(500).optional(),
  repoPath: z.string().max(1000).optional(),
  /** Optional initial project context — seeded into the knowledge store. */
  context: z.string().max(200_000).optional(),
  /** Optional named JSON Schemas (schema is a JSON string) — saved to the project. */
  schemas: z.array(z.object({ name: z.string().min(1).max(200), schema: z.string().min(1).max(200_000) })).max(20).optional(),
});

const SchemaBody = z.object({
  name: z.string().min(1).max(200),
  schema: z.string().min(1).max(200_000), // JSON string
});

export interface ServerDeps {
  readonly engine: GuardrailEngine;
  /** Project used when a request carries no `x-arbiter-project` header (offline/demo default). */
  readonly defaultProjectId: ProjectId;
  /** Actor used when a request is unauthenticated (auth disabled / master token). */
  readonly defaultActorId: UserId;
  /** Key-based auth. When set, /v1 (except /v1/auth/*) requires a valid session. */
  readonly auth?: AuthService;
  readonly webDir?: string;
  /** Defaults to true; tests pass false to keep output readable. */
  readonly logger?: boolean;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });
  const config = getConfig();

  // Key-based session auth. Public: health, status, and the login/logout endpoints.
  // Everything else under /v1 requires a valid session (or the admin master token).
  const apiToken = config.env.ARBITER_API_TOKEN;
  const bearer = (request: FastifyRequest): string => {
    const a = request.headers.authorization ?? '';
    return a.startsWith('Bearer ') ? a.slice(7).trim() : '';
  };
  const isPublic = (path: string): boolean =>
    path === '/health' ||
    path === '/api/status' ||
    path === '/v1/auth/login' ||
    path === '/v1/auth/logout' ||
    (!path.startsWith('/v1') && !path.startsWith('/api'));

  if (deps.auth || apiToken) {
    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      if (isPublic(path)) return;
      const token = bearer(request);
      if (apiToken && token && token === apiToken) {
        (request as WithAuth).authUserId = deps.defaultActorId;
        (request as WithAuth).authRole = 'admin';
        return;
      }
      if (deps.auth) {
        const authed = token ? await deps.auth.authenticate(token) : null;
        if (!authed) return reply.status(401).send({ error: 'unauthorized' });
        (request as WithAuth).authUserId = authed.userId;
        (request as WithAuth).authRole = authed.user.role;
        return;
      }
      return reply.status(401).send({ error: 'unauthorized' });
    });
  }

  /** The acting user for attribution — the authenticated user, or the default actor. */
  const actorFor = (request: FastifyRequest): UserId => (request as WithAuth).authUserId ?? deps.defaultActorId;

  const modes = {
    persistence: config.persistence,
    sanitizer: config.sanitizer,
    llm: config.llm,
    telemetry: config.telemetry,
    demask: config.demask,
  };

  // Real OTLP export when an endpoint is configured; best-effort, never blocks a request.
  const otlpExporter = config.env.OTEL_EXPORTER_OTLP_ENDPOINT
    ? new OtlpHttpExporter(config.env.OTEL_EXPORTER_OTLP_ENDPOINT, config.env.OTEL_SERVICE_NAME)
    : null;

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
  app.get('/api/status', async () => ({
    modes,
    models: config.models,
    integrations: { jira: config.jira.configured },
    authEnabled: Boolean(deps.auth),
  }));

  // ----- Auth (email-delivered access key → session with expiry) -----
  app.post('/v1/auth/login', async (request, reply) => {
    if (!deps.auth) return reply.status(501).send({ error: 'auth_disabled' });
    const parsed = z.object({ email: z.string().email(), key: z.string().min(1).max(200) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    const result = await deps.auth.login(parsed.data.email, parsed.data.key);
    if (!result) return reply.status(401).send({ error: 'invalid_credentials' });
    return result; // { token, expiresAt, user }
  });

  app.post('/v1/auth/logout', async (request) => {
    if (deps.auth) await deps.auth.logout(bearer(request));
    return { ok: true };
  });

  app.get('/v1/auth/me', async (request, reply) => {
    const uid = (request as WithAuth).authUserId;
    if (!uid) return reply.status(401).send({ error: 'unauthorized' });
    const user = await deps.engine.repos.users.get(uid);
    return user ? { user: toPublicUser(user) } : reply.status(401).send({ error: 'unauthorized' });
  });

  // Issue/rotate an access key for an email (admin only). In offline/dev the key is
  // returned so the admin can relay it; a real deployment emails it (SES/SMTP).
  app.post('/v1/auth/issue-key', async (request, reply) => {
    if (!deps.auth) return reply.status(501).send({ error: 'auth_disabled' });
    if ((request as WithAuth).authRole !== 'admin') return reply.status(403).send({ error: 'forbidden' });
    const parsed = z.object({ email: z.string().email(), role: z.enum(['qa', 'qa_lead', 'admin']).default('qa') }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    const { user, key } = await deps.auth.issueKey(parsed.data.email, parsed.data.role);
    app.log.info(`[auth] issued access key for ${user.email} (role ${user.role})`);
    return { user, key };
  });

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
    const { name, classification, description, repoUrl, repoPath, context, schemas } = parsed.data;

    // Validate any schema JSON up front so we don't half-create the project.
    const parsedSchemas: { name: string; schema: unknown }[] = [];
    for (const s of schemas ?? []) {
      try {
        parsedSchemas.push({ name: s.name, schema: JSON.parse(s.schema) });
      } catch {
        return reply.status(400).send({ error: 'invalid_schema_json', schema: s.name });
      }
    }

    const project = Project.parse({
      id: newProjectId(),
      name,
      classification,
      ...(description ? { description } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoPath ? { repoPath } : {}),
      createdAt: nowIso(),
    });
    await deps.engine.repos.projects.upsert(project);

    // Seed the project's OWN context into knowledge (sanitized — never a PHI sink).
    if (context && context.trim()) {
      const safe = (await deps.engine.sanitizer.sanitize(context)).sanitizedText;
      const docId = newKnowledgeDocId();
      await deps.engine.repos.knowledge.addDocument(
        KnowledgeDocument.parse({
          id: docId,
          projectId: project.id,
          title: 'Project context',
          sourceType: 'paste',
          citation: 'knowledge://project-context',
          classification,
          createdAt: nowIso(),
        }),
        buildChunks(project.id, docId, safe),
      );
    }
    // Save any provided schemas.
    for (const s of parsedSchemas) {
      await deps.engine.repos.schemas.add(
        ProjectSchema.parse({ id: newProjectSchemaId(), projectId: project.id, name: s.name, schema: s.schema, createdAt: nowIso() }),
      );
    }

    return reply.status(201).send({ project });
  });

  // ----- Per-project JSON Schemas (saved once; used by the Schema Validator) -----
  app.get('/v1/schemas', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const list = await deps.engine.repos.schemas.list(projectId);
    return { schemas: list.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt })) };
  });

  app.get<{ Params: { id: string } }>('/v1/schemas/:id', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const idCheck = ProjectSchemaId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    const s = await deps.engine.repos.schemas.get(projectId, idCheck.data);
    return s ? { schema: s } : reply.status(404).send({ error: 'not_found' });
  });

  app.post('/v1/schemas', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const parsed = SchemaBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    let schema: unknown;
    try {
      schema = JSON.parse(parsed.data.schema);
    } catch {
      return reply.status(400).send({ error: 'invalid_schema_json' });
    }
    const saved = await deps.engine.repos.schemas.add(
      ProjectSchema.parse({ id: newProjectSchemaId(), projectId, name: parsed.data.name, schema, createdAt: nowIso() }),
    );
    return reply.status(201).send({ schema: { id: saved.id, name: saved.name, createdAt: saved.createdAt } });
  });

  app.delete<{ Params: { id: string } }>('/v1/schemas/:id', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const idCheck = ProjectSchemaId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    const ok = await deps.engine.repos.schemas.delete(projectId, idCheck.data);
    return ok ? { deleted: true } : reply.status(404).send({ error: 'not_found' });
  });

  // Validate a data file (JSON) against a saved schema. Returns errors with paths;
  // never echoes data values (no PII leak). Data is validated locally, not stored.
  app.post<{ Params: { id: string } }>('/v1/schemas/:id/validate', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const idCheck = ProjectSchemaId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    const parsed = z.object({ data: z.string().min(1).max(2_000_000) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const s = await deps.engine.repos.schemas.get(projectId, idCheck.data);
    if (!s) return reply.status(404).send({ error: 'not_found' });
    let data: unknown;
    try {
      data = JSON.parse(parsed.data.data);
    } catch {
      return reply.status(400).send({ error: 'invalid_json', message: 'The data file is not valid JSON.' });
    }
    return validateData(s.schema, data);
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
    if (body.useGraph) {
      const graphCtx = await retrieveGraphContext(deps.engine.repos, projectId, body.requirement);
      context = [...graphCtx, ...context];
    }

    const tracer = new InMemoryTracer();
    const outcome = await runWorkflow(
      deps.engine,
      def,
      {
        projectId,
        actorId: actorFor(request),
        requirement: body.requirement,
        context,
        ...(body.riskTier ? { riskTier: body.riskTier } : {}),
        autoApprove: body.autoApprove,
        simulateHallucination: body.simulateHallucination,
      },
      { tracer },
    );

    const root = tracer.roots[0];
    if (otlpExporter) void otlpExporter.export(tracer.roots);
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

  // Streaming run (SSE): emits stage progress + reasoning deltas, then the outcome.
  app.post<{ Params: { id: string } }>('/v1/workflows/:id/run/stream', async (request, reply) => {
    const def = getWorkflow(request.params.id);
    if (!def) return reply.status(404).send({ error: 'unknown_workflow', id: request.params.id });
    const parsed = RunBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const body = parsed.data;
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;

    let context = body.context;
    if (body.useKnowledge) {
      context = [...toKnowledgeContext(await retrieveKnowledge(deps.engine.repos, projectId, body.requirement, 4)), ...context];
    }
    if (body.useGraph) {
      context = [...(await retrieveGraphContext(deps.engine.repos, projectId, body.requirement)), ...context];
    }

    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const send = (event: string, data: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('open', { workflow: def.id, outputView: def.ui.outputView });

    const tracer = new InMemoryTracer();
    try {
      const outcome = await runWorkflow(
        deps.engine,
        def,
        {
          projectId,
          actorId: actorFor(request),
          requirement: body.requirement,
          context,
          ...(body.riskTier ? { riskTier: body.riskTier } : {}),
          autoApprove: body.autoApprove,
          simulateHallucination: body.simulateHallucination,
        },
        { tracer, onProgress: (stage) => send('stage', { stage }), onReasoning: (delta) => send('reasoning', { delta }) },
      );
      const root = tracer.roots[0];
      if (otlpExporter) void otlpExporter.export(tracer.roots);
      send('done', {
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
        contextPack: outcome.contextPack.items.map((i) => ({ id: i.id, title: i.title, citation: i.citation, classification: i.classification, syncedAt: i.syncedAt ?? null })),
        output: outcome.output,
        grounding: outcome.grounding,
        review: outcome.review,
        audit: outcome.audit.map((a) => ({ action: a.action, at: a.createdAt, detail: a.detail })),
        trace: root ? { text: renderTrace(root), tree: root } : null,
      });
    } catch (e) {
      send('error', { message: e instanceof Error ? e.message : String(e) });
    } finally {
      reply.raw.end();
    }
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

  // ----- Per-project knowledge graph (GraphRAG) -----
  app.get('/v1/graph', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const [nodes, edges] = await Promise.all([deps.engine.repos.graph.listNodes(projectId), deps.engine.repos.graph.listEdges(projectId)]);
    return {
      nodes: nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, mentions: n.mentions })),
      edges: edges.map((e) => ({ source: e.sourceId, target: e.targetId, relation: e.relation, weight: e.weight })),
    };
  });

  // Rebuild the graph from the project's current knowledge.
  app.post('/v1/graph/build', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const result = await buildProjectGraph(deps.engine.repos, projectId);
    return { built: result };
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
      reviewer: actorFor(request),
      ...(editDiff ? { editDiff } : {}),
      ...(dwellMs !== undefined ? { dwellMs } : {}),
      decidedAt: now,
      createdAt: now,
    });
    const audit = AuditEvent.parse({
      id: newAuditEventId(),
      projectId,
      actorId: actorFor(request),
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
