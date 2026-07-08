import type {
  Artifact,
  ArtifactId,
  ArtifactStatus,
  AuditEvent,
  GraphEdge,
  GraphNode,
  KnowledgeChunk,
  KnowledgeDocId,
  KnowledgeDocument,
  Project,
  ProjectId,
  ProjectSchema,
  ProjectSchemaId,
  ReviewLog,
  Session,
  SessionId,
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
  /**
   * Apply a review decision as ONE transaction so a governed state change can
   * never be left without its audit row (the 'every action audited' invariant).
   */
  applyReviewDecision(write: ReviewDecisionWrite): Promise<Artifact | null>;
  close(): Promise<void>;
}
