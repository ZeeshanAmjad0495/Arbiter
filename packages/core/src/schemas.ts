import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Identifiers (branded so a ProjectId can't be passed where a UserId  *
 * is expected). All are UUIDv4.                                        *
 * ------------------------------------------------------------------ */

export const ProjectId = z.string().uuid().brand<'ProjectId'>();
export type ProjectId = z.infer<typeof ProjectId>;

export const UserId = z.string().uuid().brand<'UserId'>();
export type UserId = z.infer<typeof UserId>;

export const WorkflowRunId = z.string().uuid().brand<'WorkflowRunId'>();
export type WorkflowRunId = z.infer<typeof WorkflowRunId>;

export const ArtifactId = z.string().uuid().brand<'ArtifactId'>();
export type ArtifactId = z.infer<typeof ArtifactId>;

export const AuditEventId = z.string().uuid().brand<'AuditEventId'>();
export type AuditEventId = z.infer<typeof AuditEventId>;

export const ReviewLogId = z.string().uuid().brand<'ReviewLogId'>();
export type ReviewLogId = z.infer<typeof ReviewLogId>;

export const newProjectId = (): ProjectId => ProjectId.parse(randomUUID());
export const newUserId = (): UserId => UserId.parse(randomUUID());
export const newWorkflowRunId = (): WorkflowRunId => WorkflowRunId.parse(randomUUID());
export const newArtifactId = (): ArtifactId => ArtifactId.parse(randomUUID());
export const newAuditEventId = (): AuditEventId => AuditEventId.parse(randomUUID());
export const newReviewLogId = (): ReviewLogId => ReviewLogId.parse(randomUUID());

/* ------------------------------------------------------------------ *
 * Governance primitives                                               *
 * ------------------------------------------------------------------ */

/** Drives the risk-tiered human-review policy (§8 of the plan). */
export const RiskTier = z.enum(['low', 'medium', 'high']);
export type RiskTier = z.infer<typeof RiskTier>;

/** Per-project data classification — gates which models/connectors are allowed. */
export const DataClassification = z.enum(['public', 'internal', 'confidential', 'restricted']);
export type DataClassification = z.infer<typeof DataClassification>;

/* ------------------------------------------------------------------ *
 * Stage 1 — Sanitization                                              *
 * ------------------------------------------------------------------ */

export const SanitizationFindingType = z.enum([
  'PERSON',
  'EMAIL_ADDRESS',
  'PHONE_NUMBER',
  'US_SSN',
  'CREDIT_CARD',
  'MEMBER_ID',
  'API_KEY',
  'JWT',
  'PASSWORD',
  'INTERNAL_URL',
  'IP_ADDRESS',
  'DATE_OF_BIRTH',
  'GENERIC_SECRET',
  'OTHER',
]);
export type SanitizationFindingType = z.infer<typeof SanitizationFindingType>;

/**
 * A single redaction. We deliberately never store the original matched text —
 * only its type, span, placeholder, and detector confidence — so the audit log
 * itself can't become a PII sink.
 */
export const SanitizationFinding = z.object({
  type: SanitizationFindingType,
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  placeholder: z.string(),
  score: z.number().min(0).max(1),
  engine: z.enum(['presidio', 'regex']),
});
export type SanitizationFinding = z.infer<typeof SanitizationFinding>;

export const SanitizationReport = z.object({
  // 'regex-fallback' = Presidio was configured but unreachable and we degraded to
  // regex — a security-relevant signal, distinct from a plain regex deployment.
  engine: z.enum(['presidio', 'regex', 'regex-fallback']),
  sanitizedText: z.string(),
  findings: z.array(SanitizationFinding),
  /** True when the input contained something that must NEVER be sent (e.g. live credential). */
  blocked: z.boolean(),
  blockReasons: z.array(z.string()),
  /** sha256 of the SANITIZED text, for audit correlation without a reversible PHI hash. */
  originalSha256: z.string(),
});
export type SanitizationReport = z.infer<typeof SanitizationReport>;

/* ------------------------------------------------------------------ *
 * Stage 2 — Grounding context pack (user-visible outbound context)    *
 * ------------------------------------------------------------------ */

export const ContextPackItem = z.object({
  id: z.string(),
  sourceType: z.enum(['jira', 'confluence', 'openapi', 'schema', 'repo', 'upload', 'paste', 'other']),
  title: z.string(),
  content: z.string(),
  citation: z.string(),
  classification: DataClassification.default('internal'),
  /** ISO timestamp of the source's last sync; drives staleness badges. */
  syncedAt: z.string().datetime().optional(),
});
export type ContextPackItem = z.infer<typeof ContextPackItem>;

export const ContextPack = z.object({
  id: z.string(),
  projectId: ProjectId,
  items: z.array(ContextPackItem),
  assembledAt: z.string().datetime(),
});
export type ContextPack = z.infer<typeof ContextPack>;

/* ------------------------------------------------------------------ *
 * Stage 4 — Grounding validation                                      *
 * ------------------------------------------------------------------ */

export const GroundingClaim = z.object({
  kind: z.enum(['field', 'endpoint', 'requirement', 'entity']),
  value: z.string(),
  status: z.enum(['grounded', 'ungrounded', 'unknown']),
  /** Which context-pack item id it was found in, when grounded. */
  foundIn: z.string().optional(),
});
export type GroundingClaim = z.infer<typeof GroundingClaim>;

export const GroundingReport = z.object({
  claims: z.array(GroundingClaim),
  violations: z.number().int().nonnegative(),
  /** True when ungrounded claims exist and policy blocks export. */
  blockedExport: z.boolean(),
});
export type GroundingReport = z.infer<typeof GroundingReport>;

/* ------------------------------------------------------------------ *
 * Stage 5 — Review gate                                               *
 * ------------------------------------------------------------------ */

export const ReviewDecision = z.enum(['pending', 'approved', 'rejected', 'needs_changes']);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const ReviewMode = z.enum(['pre_approval', 'post_hoc_sample', 'auto']);
export type ReviewMode = z.infer<typeof ReviewMode>;

export const ReviewRecord = z.object({
  decision: ReviewDecision,
  riskTier: RiskTier,
  /** For low-risk items that are sampled post-hoc rather than pre-approved. */
  mode: ReviewMode,
  reviewer: UserId.optional(),
  decidedAt: z.string().datetime().optional(),
  /** Captured reviewer edit-diff — the raw material for the feedback flywheel. */
  editDiff: z.string().optional(),
  dwellMs: z.number().int().nonnegative().optional(),
});
export type ReviewRecord = z.infer<typeof ReviewRecord>;

/** A persisted human review decision on an artifact (append-only history). */
export const ReviewLog = z.object({
  id: ReviewLogId,
  projectId: ProjectId,
  artifactId: ArtifactId,
  decision: ReviewDecision,
  mode: ReviewMode,
  riskTier: RiskTier,
  reviewer: UserId.optional(),
  /** Unified diff of the reviewer's edits to the generated content (flywheel signal). */
  editDiff: z.string().optional(),
  dwellMs: z.number().int().nonnegative().optional(),
  decidedAt: z.string().datetime().optional(),
  createdAt: z.string().datetime(),
});
export type ReviewLog = z.infer<typeof ReviewLog>;

/* ------------------------------------------------------------------ *
 * Audit                                                               *
 * ------------------------------------------------------------------ */

export const AuditAction = z.enum([
  'workflow.run',
  'sanitize',
  'ground',
  'generate',
  'validate',
  'gate.decision',
  'write.apply',
  'demask.resolve',
  'demask.purge',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEvent = z.object({
  id: AuditEventId,
  projectId: ProjectId,
  actorId: UserId,
  workflowRunId: WorkflowRunId,
  action: AuditAction,
  /** sha256 of the sanitized input — correlate without storing content. */
  inputSha256: z.string().optional(),
  promptVersion: z.string().optional(),
  model: z.string().optional(),
  /** Citations/source ids that fed this step. */
  sources: z.array(z.string()).default([]),
  /** Non-sensitive structured detail (counts, flags, decision). */
  detail: z.record(z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;

/* ------------------------------------------------------------------ *
 * Artifacts (the reviewable output of any workflow)                   *
 * ------------------------------------------------------------------ */

export const ArtifactStatus = z.enum(['draft', 'in_review', 'approved', 'rejected', 'exported']);
export type ArtifactStatus = z.infer<typeof ArtifactStatus>;

export const Artifact = z.object({
  id: ArtifactId,
  projectId: ProjectId,
  workflowRunId: WorkflowRunId,
  type: z.string(),
  status: ArtifactStatus,
  riskTier: RiskTier.default('medium'),
  /** The structured, schema-validated payload of the workflow. */
  content: z.unknown(),
  promptVersion: z.string().optional(),
  model: z.string().optional(),
  createdBy: UserId,
  createdAt: z.string().datetime(),
});
export type Artifact = z.infer<typeof Artifact>;

/* ------------------------------------------------------------------ *
 * Project & User (Phase 0 minimal)                                    *
 * ------------------------------------------------------------------ */

export const Project = z.object({
  id: ProjectId,
  name: z.string(),
  classification: DataClassification.default('internal'),
  /** Optional setup metadata captured at create time. */
  description: z.string().optional(),
  repoUrl: z.string().optional(),
  repoPath: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Project = z.infer<typeof Project>;

/* Per-project JSON Schemas — saved once, then reused to validate data files. */
export const ProjectSchemaId = z.string().uuid().brand<'ProjectSchemaId'>();
export type ProjectSchemaId = z.infer<typeof ProjectSchemaId>;
export const newProjectSchemaId = (): ProjectSchemaId => ProjectSchemaId.parse(randomUUID());

export const ProjectSchema = z.object({
  id: ProjectSchemaId,
  projectId: ProjectId,
  name: z.string(),
  /** The JSON Schema document (arbitrary JSON). */
  schema: z.unknown(),
  createdAt: z.string().datetime(),
});
export type ProjectSchema = z.infer<typeof ProjectSchema>;

export const UserRole = z.enum(['qa', 'qa_lead', 'admin']);
export type UserRole = z.infer<typeof UserRole>;

export const User = z.object({
  id: UserId,
  email: z.string().email(),
  role: UserRole.default('qa'),
  /** sha256 of the user's access key (the key itself is emailed, never stored). */
  accessKeyHash: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type User = z.infer<typeof User>;

/** A safe, client-facing view of a user — never includes the access-key hash. */
export const PublicUser = z.object({ id: UserId, email: z.string().email(), role: UserRole });
export type PublicUser = z.infer<typeof PublicUser>;
export const toPublicUser = (u: User): PublicUser => ({ id: u.id, email: u.email, role: u.role });

/* ------------------------------------------------------------------ *
 * Auth sessions (key-based login → session with expiry)               *
 * ------------------------------------------------------------------ */

export const SessionId = z.string().uuid().brand<'SessionId'>();
export type SessionId = z.infer<typeof SessionId>;
export const newSessionId = (): SessionId => SessionId.parse(randomUUID());

export const Session = z.object({
  id: SessionId,
  userId: UserId,
  /** sha256 of the opaque session token (the token is sent to the client, not stored). */
  tokenHash: z.string(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type Session = z.infer<typeof Session>;

/* ------------------------------------------------------------------ *
 * Per-project knowledge (RAG substrate) — project-scoped, read-only   *
 * ground source. Documents are chunked; retrieval assembles a context  *
 * pack so generation is project-aware without re-pasting.             *
 * ------------------------------------------------------------------ */

export const KnowledgeDocId = z.string().uuid().brand<'KnowledgeDocId'>();
export type KnowledgeDocId = z.infer<typeof KnowledgeDocId>;
export const KnowledgeChunkId = z.string().uuid().brand<'KnowledgeChunkId'>();
export type KnowledgeChunkId = z.infer<typeof KnowledgeChunkId>;

export const newKnowledgeDocId = (): KnowledgeDocId => KnowledgeDocId.parse(randomUUID());
export const newKnowledgeChunkId = (): KnowledgeChunkId => KnowledgeChunkId.parse(randomUUID());

export const KnowledgeSourceType = z.enum(['jira', 'confluence', 'openapi', 'schema', 'repo', 'upload', 'paste', 'other']);
export type KnowledgeSourceType = z.infer<typeof KnowledgeSourceType>;

export const KnowledgeDocument = z.object({
  id: KnowledgeDocId,
  projectId: ProjectId,
  title: z.string(),
  sourceType: KnowledgeSourceType.default('paste'),
  citation: z.string(),
  classification: DataClassification.default('internal'),
  createdAt: z.string().datetime(),
});
export type KnowledgeDocument = z.infer<typeof KnowledgeDocument>;

export const KnowledgeChunk = z.object({
  id: KnowledgeChunkId,
  projectId: ProjectId,
  docId: KnowledgeDocId,
  /** 0-based position within the document. */
  ordinal: z.number().int().nonnegative(),
  content: z.string(),
  createdAt: z.string().datetime(),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunk>;

/* ------------------------------------------------------------------ *
 * Per-project knowledge graph (GraphRAG) — nodes + typed edges built   *
 * from the project's knowledge; graph-aware retrieval expands the       *
 * neighborhood of query-seeded nodes into the grounding context.       *
 * ------------------------------------------------------------------ */

export const GraphNodeId = z.string().uuid().brand<'GraphNodeId'>();
export type GraphNodeId = z.infer<typeof GraphNodeId>;
export const GraphEdgeId = z.string().uuid().brand<'GraphEdgeId'>();
export type GraphEdgeId = z.infer<typeof GraphEdgeId>;
export const newGraphNodeId = (): GraphNodeId => GraphNodeId.parse(randomUUID());
export const newGraphEdgeId = (): GraphEdgeId => GraphEdgeId.parse(randomUUID());

export const GraphNodeType = z.enum(['field', 'endpoint', 'requirement', 'test', 'control', 'term']);
export type GraphNodeType = z.infer<typeof GraphNodeType>;

export const GraphNode = z.object({
  id: GraphNodeId,
  projectId: ProjectId,
  /** Canonical label (the entity text, e.g. "member_id", "REQ-101", "/v2/checkout/redeem"). */
  label: z.string(),
  type: GraphNodeType,
  /** How many chunks mention this entity — a salience signal for ranking. */
  mentions: z.number().int().nonnegative().default(1),
  createdAt: z.string().datetime(),
});
export type GraphNode = z.infer<typeof GraphNode>;

export const GraphEdge = z.object({
  id: GraphEdgeId,
  projectId: ProjectId,
  sourceId: GraphNodeId,
  targetId: GraphNodeId,
  /** Relationship label (e.g. "co_occurs", "references", "has_field"). */
  relation: z.string(),
  /** Edge strength (e.g. co-occurrence count) — drives expansion ranking. */
  weight: z.number().nonnegative().default(1),
  createdAt: z.string().datetime(),
});
export type GraphEdge = z.infer<typeof GraphEdge>;

/* ------------------------------------------------------------------ *
 * Test execution runner — Arbiter AUTHORS tests (Playwright/k6); this   *
 * captures the result of EXECUTING one via the real tool, normalized so *
 * pass/fail flows back into the quality metrics. "Integrate, don't      *
 * reinvent": we run the industry tools and read their reporters.        *
 * ------------------------------------------------------------------ */

export const ExecutionId = z.string().uuid().brand<'ExecutionId'>();
export type ExecutionId = z.infer<typeof ExecutionId>;
export const newExecutionId = (): ExecutionId => ExecutionId.parse(randomUUID());

export const RunnerKind = z.enum(['playwright', 'k6']);
export type RunnerKind = z.infer<typeof RunnerKind>;

/** Overall verdict: passed (all green), failed (assertions/thresholds broke), error (runner never produced a result). */
export const ExecutionStatus = z.enum(['passed', 'failed', 'error']);
export type ExecutionStatus = z.infer<typeof ExecutionStatus>;

export const ExecutionCase = z.object({
  name: z.string(),
  status: z.enum(['passed', 'failed', 'skipped']),
  durationMs: z.number().nonnegative().default(0),
  /** Failure detail (assertion message / threshold). Trimmed; never the script body. */
  message: z.string().optional(),
});
export type ExecutionCase = z.infer<typeof ExecutionCase>;

export const ExecutionSummary = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
});
export type ExecutionSummary = z.infer<typeof ExecutionSummary>;

export const TestExecution = z.object({
  id: ExecutionId,
  projectId: ProjectId,
  kind: RunnerKind,
  /** Human label for the run (e.g. artifact title or file name). */
  name: z.string(),
  /** 'real' = spawned the actual tool; 'offline' = deterministic stub (no binary). */
  mode: z.enum(['real', 'offline']),
  status: ExecutionStatus,
  summary: ExecutionSummary,
  cases: z.array(ExecutionCase).default([]),
  exitCode: z.number().int().nullable().default(null),
  /** Runner-level failure (tool missing, timeout, unparseable output) — distinct from a test that failed. */
  error: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type TestExecution = z.infer<typeof TestExecution>;

/* ------------------------------------------------------------------ *
 * The end-to-end outcome of one pass through the guardrail pipeline.  *
 * ------------------------------------------------------------------ */

export interface GuardrailOutcome<TOutput> {
  readonly runId: WorkflowRunId;
  readonly projectId: ProjectId;
  readonly sanitization: SanitizationReport;
  readonly contextPack: ContextPack;
  readonly output: TOutput | null;
  readonly grounding: GroundingReport;
  readonly review: ReviewRecord;
  readonly audit: readonly AuditEvent[];
  readonly model: string;
  readonly promptVersion: string;
}
