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
  RunnerKind,
  TestExecution,
  newAuditEventId,
  newExecutionId,
  newKnowledgeDocId,
  newProjectId,
  newProjectSchemaId,
  newReviewLogId,
  newWorkflowRunId,
  nowIso,
  toPublicUser,
  unifiedDiff,
} from '@arbiter/core';
import { UserId } from '@arbiter/core';
import {
  type GuardrailEngine,
  WriteGate,
  type WritePlan,
  buildChunks,
  buildProjectGraph,
  computeQualityMetrics,
  embedOne,
  embedTexts,
  embeddingsEnabled,
  retrieveGraphContext,
  retrieveKnowledge,
  toKnowledgeContext,
  writeTargetFor,
} from '@arbiter/guardrail';
import type { KnowledgeChunk } from '@arbiter/core';
import { type TestRunner, createRunner } from '@arbiter/runner';
import { sanitizeJson } from '@arbiter/sanitize';
import { InMemoryTracer, OtlpHttpExporter, renderTrace } from '@arbiter/telemetry';
import { getWorkflow, listPromptTemplates, listWorkflowsMeta, runWorkflow } from '@arbiter/workflows';
import type { AuthService } from './auth';
import { fetchConfluencePage } from './confluence';
import { fetchJiraIssue } from './jira';
import { writeSnapshot } from './snapshot';
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
  /** Test execution runner. Defaults to config-selected (offline unless ARBITER_RUNNER=real). */
  readonly runner?: TestRunner;
  readonly webDir?: string;
  /** Defaults to true; tests pass false to keep output readable. */
  readonly logger?: boolean;
}

export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: deps.logger ?? true });
  const config = getConfig();
  const runner = deps.runner ?? createRunner(config);

  // The ONLY path Arbiter writes: named human approval → apply → verify → audit.
  // Targets a real GitHub repo when configured, else the in-memory sandbox; it
  // hard-refuses the connected Jira workspace at register + apply time.
  const writeTarget = writeTargetFor(config);
  const writeGate = new WriteGate(deps.engine.repos.audit);
  writeGate.register(writeTarget);

  // Dense retrieval (opt-in, free/local embeddings). When enabled, new chunks get an
  // embedding and retrieval searches by vector similarity; otherwise TF-IDF is used.
  const dense = embeddingsEnabled(config);
  const denseOpts = dense ? { embed: embedOne } : undefined;
  async function embedChunks(projectId: ProjectId, chunks: KnowledgeChunk[]): Promise<void> {
    if (!dense || chunks.length === 0) return;
    const vecs = await embedTexts(chunks.map((c) => c.content));
    await Promise.all(chunks.map((c, i) => (vecs[i] ? deps.engine.repos.knowledge.setChunkEmbedding(projectId, c.id, vecs[i]!) : Promise.resolve())));
  }

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

  // Step-up re-auth for destructive actions: the caller must re-enter their access
  // key. Enforced only when auth is enabled; skipped for the dev/no-auth path.
  async function requireStepUp(request: FastifyRequest, reply: FastifyReply, confirmKey: unknown): Promise<boolean> {
    if (!deps.auth) return true;
    const uid = (request as WithAuth).authUserId;
    if (!uid || typeof confirmKey !== 'string' || !(await deps.auth.verifyKey(uid, confirmKey))) {
      reply.status(403).send({ error: 'step_up_required', message: 'Re-enter your access key to confirm this destructive action.' });
      return false;
    }
    return true;
  }
  const ConfirmBody = z.object({ confirmKey: z.string().optional() });

  const modes = {
    persistence: config.persistence,
    sanitizer: config.sanitizer,
    llm: config.llm,
    telemetry: config.telemetry,
    demask: config.demask,
    // Durable = the encrypted de-mask vault persists to Postgres (survives restarts)
    // rather than living only in this process's memory.
    demaskDurable: config.demask === 'encrypted' && config.persistence === 'postgres',
    runner: config.runner,
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
    if (!(await canAccessProject(request, parsed.data))) {
      reply.status(403).send({ error: 'project_forbidden', message: 'You do not have access to this project. Ask an admin to grant it.' });
      return null;
    }
    return parsed.data;
  }

  // Admins reach every project; the default project is open; everyone else needs a
  // membership grant. When auth is disabled (dev), everything is open.
  async function canAccessProject(request: FastifyRequest, projectId: ProjectId): Promise<boolean> {
    if (!deps.auth || (request as WithAuth).authRole === 'admin' || projectId === deps.defaultProjectId) return true;
    const uid = (request as WithAuth).authUserId;
    return uid ? deps.engine.repos.members.isMember(projectId, uid) : false;
  }
  const isAdmin = (request: FastifyRequest): boolean => (request as WithAuth).authRole === 'admin';

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

  // Invite/re-issue a TEMPORARY access key for an email (admin only). In offline/dev
  // the key is returned so the admin can relay it; a deployment emails it (SES/SMTP).
  // `temporary` (default true) forces the user to set their own key on first login.
  app.post('/v1/auth/issue-key', async (request, reply) => {
    if (!deps.auth) return reply.status(501).send({ error: 'auth_disabled' });
    if ((request as WithAuth).authRole !== 'admin') return reply.status(403).send({ error: 'forbidden' });
    const parsed = z.object({ email: z.string().email(), role: z.enum(['qa', 'qa_lead', 'admin']).default('qa'), temporary: z.boolean().default(true) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body' });
    const { user, key } = await deps.auth.issueKey(parsed.data.email, parsed.data.role, parsed.data.temporary);
    app.log.info(`[auth] issued ${parsed.data.temporary ? 'temporary ' : ''}access key for ${user.email} (role ${user.role})`);
    return { user, key };
  });

  // First-login rotation: the signed-in user generates their own permanent key.
  // Returns the new key ONCE (the UI shows it a single time). Clears mustRotate.
  app.post('/v1/auth/rotate-key', async (request, reply) => {
    if (!deps.auth) return reply.status(501).send({ error: 'auth_disabled' });
    const uid = (request as WithAuth).authUserId;
    if (!uid) return reply.status(401).send({ error: 'unauthorized' });
    const result = await deps.auth.rotateKey(uid);
    return result ? { key: result.key } : reply.status(404).send({ error: 'not_found' });
  });

  // ----- Admin: users, roles, and per-project access (admin-only) -----
  app.get('/v1/admin/users', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ error: 'forbidden' });
    const users = await deps.engine.repos.users.list();
    const rows = await Promise.all(
      users.map(async (u) => ({ id: u.id, email: u.email, role: u.role, hasKey: Boolean(u.accessKeyHash), projectIds: await deps.engine.repos.members.projectsForUser(u.id) })),
    );
    return { users: rows };
  });

  app.post<{ Params: { id: string } }>('/v1/admin/users/:id/role', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ error: 'forbidden' });
    const uid = UserId.safeParse(request.params.id);
    const parsed = z.object({ role: z.enum(['qa', 'qa_lead', 'admin']) }).safeParse(request.body ?? {});
    if (!uid.success || !parsed.success) return reply.status(400).send({ error: 'invalid' });
    const user = await deps.engine.repos.users.get(uid.data);
    if (!user) return reply.status(404).send({ error: 'not_found' });
    await deps.engine.repos.users.upsert({ ...user, role: parsed.data.role });
    return { ok: true };
  });

  // Set a user's project access to exactly the given list (grants/revokes the diff).
  app.put<{ Params: { id: string } }>('/v1/admin/users/:id/projects', async (request, reply) => {
    if (!isAdmin(request)) return reply.status(403).send({ error: 'forbidden' });
    const uid = UserId.safeParse(request.params.id);
    const parsed = z.object({ projectIds: z.array(ProjectId).max(500) }).safeParse(request.body ?? {});
    if (!uid.success || !parsed.success) return reply.status(400).send({ error: 'invalid' });
    if (!(await deps.engine.repos.users.get(uid.data))) return reply.status(404).send({ error: 'not_found' });
    const want = new Set<string>(parsed.data.projectIds);
    const have = new Set<string>(await deps.engine.repos.members.projectsForUser(uid.data));
    await Promise.all([
      ...parsed.data.projectIds.filter((p) => !have.has(p)).map((p) => deps.engine.repos.members.grant(p, uid.data)),
      ...[...have].filter((p) => !want.has(p)).map((p) => deps.engine.repos.members.revoke(ProjectId.parse(p), uid.data)),
    ]);
    return { ok: true };
  });

  // ----- Projects (multi-tenant surface) -----
  app.get('/v1/projects', async (request) => {
    let projects = await deps.engine.repos.projects.list();
    const uid = (request as WithAuth).authUserId;
    // Non-admins see only the default project + the ones they've been granted.
    if (!isAdmin(request) && uid) {
      const allowed = new Set<string>([deps.defaultProjectId, ...(await deps.engine.repos.members.projectsForUser(uid))]);
      projects = projects.filter((p) => allowed.has(p.id));
    }
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
    // The creator gets access to their new project (admins already reach everything).
    await deps.engine.repos.members.grant(project.id, actorFor(request));

    // Seed the project's OWN context into knowledge (sanitized — never a PHI sink).
    if (context && context.trim()) {
      const safe = (await deps.engine.sanitizer.sanitize(context, project.id)).sanitizedText;
      const docId = newKnowledgeDocId();
      const chunks = buildChunks(project.id, docId, safe);
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
        chunks,
      );
      await embedChunks(project.id, chunks);
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
    if (!(await requireStepUp(request, reply, ConfirmBody.safeParse(request.body ?? {}).data?.confirmKey))) return reply;
    const existing = await deps.engine.repos.schemas.get(projectId, idCheck.data);
    if (!existing) return reply.status(404).send({ error: 'not_found' });
    writeSnapshot('schema', projectId, existing); // recoverable backup before delete
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

  // Read-only Confluence page fetch (grounding source; same read-only invariant as Jira).
  app.get<{ Params: { id: string } }>('/v1/confluence/:id', async (request, reply) => {
    if (!config.confluence.configured) {
      return reply
        .status(501)
        .send({ error: 'confluence_not_configured', message: 'Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN in .env to enable Confluence fetch.' });
    }
    if (!/^[0-9]{1,20}$/.test(request.params.id)) return reply.status(400).send({ error: 'invalid_page_id' });
    try {
      return reply.send({ context: await fetchConfluencePage(request.params.id) });
    } catch (e) {
      return reply.status(502).send({ error: 'confluence_fetch_failed', message: e instanceof Error ? e.message : String(e) });
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
      const retrieved = await retrieveKnowledge(deps.engine.repos, projectId, body.requirement, 4, denseOpts);
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
      context = [...toKnowledgeContext(await retrieveKnowledge(deps.engine.repos, projectId, body.requirement, 4, denseOpts)), ...context];
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
    const safe = (await deps.engine.sanitizer.sanitize(content, projectId)).sanitizedText;
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
    await embedChunks(projectId, chunks);
    return reply.status(201).send({ document: { id: doc.id, title: doc.title, chunks: chunks.length } });
  });

  app.delete<{ Params: { id: string } }>('/v1/knowledge/:id', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const idCheck = KnowledgeDocId.safeParse(request.params.id);
    if (!idCheck.success) return reply.status(400).send({ error: 'invalid_id' });
    if (!(await requireStepUp(request, reply, ConfirmBody.safeParse(request.body ?? {}).data?.confirmKey))) return reply;
    const doc = (await deps.engine.repos.knowledge.listDocuments(projectId)).find((d) => d.id === idCheck.data);
    if (!doc) return reply.status(404).send({ error: 'not_found' });
    const chunks = (await deps.engine.repos.knowledge.listChunks(projectId)).filter((c) => c.docId === idCheck.data);
    writeSnapshot('knowledge', projectId, { doc, chunks }); // recoverable backup before delete
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

  // ----- De-mask / re-identification (admin-only PII sink) -----
  // Rehydrates sanitizer placeholders back to real values for an APPROVED artifact
  // the operator is handing off. This egresses PII, so it is admin-gated, tenant-
  // scoped (a placeholder resolves ONLY within its own project), and audited by
  // COUNT (never by value). Credentials are never stored, so `[…_REDACTED]` stays.
  app.post('/v1/demask/resolve', async (request, reply) => {
    if ((request as WithAuth).authRole !== 'admin') return reply.status(403).send({ error: 'forbidden' });
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const parsed = z.object({ text: z.string().max(200_000) }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });

    const store = deps.engine.sanitizer.demask;
    // Placeholders look like [EMAIL_ADDRESS_12]; the type may itself contain '_'.
    const tokens = [...new Set(parsed.data.text.match(/\[[A-Z0-9_]+_\d+\]/g) ?? [])];
    const resolvedMap = new Map<string, string>();
    for (const token of tokens) {
      const original = await store.resolve(token, projectId);
      if (original !== null) resolvedMap.set(token, original);
    }
    const rehydrated = parsed.data.text.replace(/\[[A-Z0-9_]+_\d+\]/g, (m) => resolvedMap.get(m) ?? m);

    await deps.engine.repos.audit.append(
      AuditEvent.parse({
        id: newAuditEventId(),
        projectId,
        actorId: actorFor(request),
        workflowRunId: newWorkflowRunId(),
        action: 'demask.resolve',
        // Counts only — the resolved PII itself is NEVER written to the audit log.
        detail: { placeholders: tokens.length, resolved: resolvedMap.size, unresolved: tokens.length - resolvedMap.size },
        createdAt: nowIso(),
      }),
    );
    return { text: rehydrated, resolved: resolvedMap.size, unresolved: tokens.length - resolvedMap.size };
  });

  // Retention: drop this project's de-mask mappings older than N hours. Admin-only,
  // project-scoped (works for the durable vault, which can't purge cross-project),
  // audited by count. Run on a schedule (cron → this endpoint) for automatic retention.
  app.post('/v1/demask/purge', async (request, reply) => {
    if ((request as WithAuth).authRole !== 'admin') return reply.status(403).send({ error: 'forbidden' });
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const parsed = z.object({ olderThanHours: z.number().positive().max(8760).default(720), confirmKey: z.string().optional() }).safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    if (!(await requireStepUp(request, reply, parsed.data.confirmKey))) return reply;

    const ageMs = parsed.data.olderThanHours * 3600 * 1000;
    // Snapshot the (encrypted) rows before purging — durable Postgres data only;
    // ephemeral/in-memory modes have nothing recoverable to back up.
    if (config.persistence === 'postgres' && config.demask === 'encrypted') {
      const rows = await deps.engine.repos.demask.exportOlderThan(projectId, Date.now() - ageMs);
      if (rows.length) writeSnapshot('demask', projectId, rows.map((r) => ({ placeholder: r.placeholder, type: r.type, cipherB64: Buffer.from(r.cipher).toString('base64'), createdAtMs: r.createdAtMs })));
    }
    const removed = await deps.engine.sanitizer.demask.purgeProjectOlderThan(projectId, ageMs);
    await deps.engine.repos.audit.append(
      AuditEvent.parse({
        id: newAuditEventId(),
        projectId,
        actorId: actorFor(request),
        workflowRunId: newWorkflowRunId(),
        action: 'demask.purge',
        detail: { olderThanHours: parsed.data.olderThanHours, removed },
        createdAt: nowIso(),
      }),
    );
    return { removed };
  });

  // ----- Test execution runner (Playwright / k6) -----
  // Executes an Arbiter-authored test with the real tool (or the deterministic
  // offline stub) and records the normalized result so pass/fail feeds Metrics.
  const ExecuteBody = z.object({
    kind: RunnerKind,
    script: z.string().min(1).max(500_000),
    name: z.string().max(200).optional(),
  });
  app.post('/v1/executions', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const parsed = ExecuteBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const { kind, script, name } = parsed.data;

    const result = await runner.run({ kind, script, name });
    const execution = TestExecution.parse({
      id: newExecutionId(),
      projectId,
      kind,
      name: name ?? `${kind} run`,
      mode: result.mode,
      status: result.status,
      summary: result.summary,
      cases: result.cases,
      exitCode: result.exitCode,
      ...(result.error ? { error: result.error } : {}),
      createdAt: nowIso(),
    });
    await deps.engine.repos.executions.create(execution);
    return { execution };
  });

  app.get('/v1/executions', async (request, reply) => {
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    return { executions: await deps.engine.repos.executions.listByProject(projectId, 50) };
  });

  // ----- Gated write-back (the only path Arbiter writes; human-approved) -----
  app.get('/v1/writeback/target', async () => ({
    id: writeTarget.id,
    live: writeTarget.id === 'github' && config.github.configured,
    repo: writeTarget.id === 'github' ? `${config.env.GITHUB_OWNER}/${config.env.GITHUB_REPO}` : null,
  }));

  // Apply a write to the configured target. Requires a role + a NAMED approver;
  // never the connected Jira (the gate hard-refuses it). Audited automatically.
  const WriteBackBody = z.object({
    resource: z.string().min(1).max(80),
    action: z.enum(['create', 'update', 'quarantine', 'comment']),
    summary: z.string().min(1).max(2000),
    payload: z.record(z.unknown()).default({}),
    approver: z.string().min(1).max(120),
    note: z.string().max(500).optional(),
  });
  app.post('/v1/writeback/apply', async (request, reply) => {
    if (!isAdmin(request) && (request as WithAuth).authRole !== 'qa_lead') return reply.status(403).send({ error: 'forbidden', message: 'Write-back requires an admin or QA lead.' });
    const projectId = await resolveProject(request, reply);
    if (!projectId) return reply;
    const parsed = WriteBackBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'invalid_body', issues: parsed.error.issues });
    const plan: WritePlan = { targetId: writeTarget.id, resource: parsed.data.resource, action: parsed.data.action, summary: parsed.data.summary, payload: parsed.data.payload };
    try {
      const result = await writeGate.apply({
        projectId,
        actorId: actorFor(request),
        plan,
        approval: { approver: parsed.data.approver, approved: true, ...(parsed.data.note ? { note: parsed.data.note } : {}) },
      });
      return { result, target: writeTarget.id };
    } catch (e) {
      // e.g. writegate_forbidden_target — never the connected Jira.
      return reply.status(422).send({ error: 'write_refused', message: e instanceof Error ? e.message : String(e) });
    }
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
      const sanitizedEdit = await sanitizeJson(editedContent, deps.engine.sanitizer, projectId);
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
