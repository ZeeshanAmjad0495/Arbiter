import type {
  Artifact,
  ArtifactId,
  ArtifactStatus,
  AuditEvent,
  GraphEdge,
  GraphNode,
  KnowledgeChunk,
  KnowledgeChunkId,
  KnowledgeDocId,
  KnowledgeDocument,
  Project,
  ProjectId,
  ProjectSchema,
  ProjectSchemaId,
  ReviewLog,
  Session,
  SessionId,
  TestExecution,
  User,
  UserId,
  WorkflowRunId,
} from '@arbiter/core';

export interface ProjectRepository {
  upsert(project: Project): Promise<Project>;
  get(id: ProjectId): Promise<Project | null>;
  list(): Promise<Project[]>;
}

export interface UserRepository {
  upsert(user: User): Promise<User>;
  get(id: UserId): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
}

export interface SessionRepository {
  create(session: Session): Promise<Session>;
  getByTokenHash(tokenHash: string): Promise<Session | null>;
  delete(id: SessionId): Promise<void>;
  /** Housekeeping: drop sessions whose expiry is before `nowIso`. Returns count. */
  deleteExpired(nowIso: string): Promise<number>;
}

/** All reads/writes are project-scoped — project_id is a mandatory parameter, never LLM-supplied. */
export interface ArtifactRepository {
  create(artifact: Artifact): Promise<Artifact>;
  get(projectId: ProjectId, id: ArtifactId): Promise<Artifact | null>;
  listByRun(projectId: ProjectId, runId: WorkflowRunId): Promise<Artifact[]>;
  /** Artifacts awaiting review (the review queue), newest first. */
  listByStatus(projectId: ProjectId, statuses: ArtifactStatus[]): Promise<Artifact[]>;
  /** Apply a review outcome: optionally replace content, always set status. */
  update(projectId: ProjectId, id: ArtifactId, patch: { content?: unknown; status: ArtifactStatus }): Promise<Artifact | null>;
}

/** Append-only. */
export interface AuditRepository {
  append(event: AuditEvent): Promise<AuditEvent>;
  listByRun(projectId: ProjectId, runId: WorkflowRunId): Promise<AuditEvent[]>;
  /** All audit for a project — feeds the quality-metrics aggregation. */
  listByProject(projectId: ProjectId): Promise<AuditEvent[]>;
}

/** Append-only human-review history. */
export interface ReviewRepository {
  append(review: ReviewLog): Promise<ReviewLog>;
  listByArtifact(projectId: ProjectId, artifactId: ArtifactId): Promise<ReviewLog[]>;
  /** All reviews for a project — feeds the quality-metrics aggregation. */
  listByProject(projectId: ProjectId): Promise<ReviewLog[]>;
}

/** A governed review decision — artifact update + review log + audit, written atomically. */
export interface ReviewDecisionWrite {
  projectId: ProjectId;
  artifactId: ArtifactId;
  status: ArtifactStatus;
  content?: unknown;
  review: ReviewLog;
  audit: AuditEvent;
}

/**
 * Per-project knowledge store (RAG substrate). Documents + their chunks are
 * project-scoped; `searchChunks` is the retrieval seam (lexical today, swappable
 * to Postgres FTS / pgvector behind this same interface).
 */
export interface KnowledgeRepository {
  addDocument(doc: KnowledgeDocument, chunks: KnowledgeChunk[]): Promise<KnowledgeDocument>;
  listDocuments(projectId: ProjectId): Promise<KnowledgeDocument[]>;
  deleteDocument(projectId: ProjectId, docId: KnowledgeDocId): Promise<boolean>;
  /** All chunks for a project (retrieval scores over these in-process today). */
  listChunks(projectId: ProjectId): Promise<KnowledgeChunk[]>;
  /** Attach a dense embedding to a chunk (dense-retrieval path). */
  setChunkEmbedding(projectId: ProjectId, chunkId: KnowledgeChunkId, embedding: number[]): Promise<void>;
  /** Top-k chunks by cosine similarity to `embedding` (unit vectors → score in 0..1). */
  searchByEmbedding(projectId: ProjectId, embedding: number[], k: number): Promise<{ chunk: KnowledgeChunk; score: number }[]>;
}

/** Per-project knowledge graph (project-scoped). Rebuilt wholesale on build. */
export interface GraphRepository {
  /** Atomically replace the project's graph with the given nodes + edges. */
  replaceGraph(projectId: ProjectId, nodes: GraphNode[], edges: GraphEdge[]): Promise<void>;
  listNodes(projectId: ProjectId): Promise<GraphNode[]>;
  listEdges(projectId: ProjectId): Promise<GraphEdge[]>;
}

/** Per-project saved JSON Schemas (project-scoped; used by the Schema Validator). */
export interface SchemaRepository {
  add(schema: ProjectSchema): Promise<ProjectSchema>;
  list(projectId: ProjectId): Promise<ProjectSchema[]>;
  get(projectId: ProjectId, id: ProjectSchemaId): Promise<ProjectSchema | null>;
  delete(projectId: ProjectId, id: ProjectSchemaId): Promise<boolean>;
}

/**
 * Durable de-mask vault (PII sink). Stores only ciphertext — encryption/decryption
 * happens in the sanitize layer, so the DB never holds plaintext PII. Every op is
 * project-scoped and RLS-isolated; placeholders are allocated atomically so two
 * concurrent sanitize() calls can never mint the same `[TYPE_n]`.
 */
export interface DemaskRepository {
  /**
   * Atomically allocate the next `[TYPE_n]` placeholder for (project, type) AND
   * persist its ciphertext in one transaction. Returns the placeholder.
   */
  store(projectId: ProjectId, type: string, cipher: Uint8Array, createdAtMs: number): Promise<string>;
  /** Ciphertext for a placeholder, iff it belongs to `projectId` (fail-closed). */
  getCipher(projectId: ProjectId, placeholder: string): Promise<{ cipher: Uint8Array; type: string } | null>;
  /** Ciphertext rows older than the cutoff — snapshotted (compressed) before a retention purge. */
  exportOlderThan(projectId: ProjectId, cutoffMs: number): Promise<{ placeholder: string; type: string; cipher: Uint8Array; createdAtMs: number }[]>;
  /** Retention control — drop this project's entries older than the cutoff. Returns count removed. */
  purgeOlderThan(projectId: ProjectId, cutoffMs: number): Promise<number>;
  count(projectId: ProjectId): Promise<number>;
}

/** Per-project test-execution history (Playwright/k6 runner results). */
export interface ExecutionRepository {
  create(exec: TestExecution): Promise<TestExecution>;
  /** Most-recent first; capped by `limit` (default 50). */
  listByProject(projectId: ProjectId, limit?: number): Promise<TestExecution[]>;
}

export interface RepositoryBundle {
  readonly kind: 'postgres' | 'memory';
  readonly projects: ProjectRepository;
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly artifacts: ArtifactRepository;
  readonly audit: AuditRepository;
  readonly reviews: ReviewRepository;
  readonly knowledge: KnowledgeRepository;
  readonly schemas: SchemaRepository;
  readonly graph: GraphRepository;
  readonly demask: DemaskRepository;
  readonly executions: ExecutionRepository;
  /**
   * Apply a review decision as ONE transaction so a governed state change can
   * never be left without its audit row (the 'every action audited' invariant).
   */
  applyReviewDecision(write: ReviewDecisionWrite): Promise<Artifact | null>;
  close(): Promise<void>;
}
