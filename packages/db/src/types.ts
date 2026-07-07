import type {
  Artifact,
  ArtifactId,
  ArtifactStatus,
  AuditEvent,
  Project,
  ProjectId,
  ReviewLog,
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

export interface RepositoryBundle {
  readonly kind: 'postgres' | 'memory';
  readonly projects: ProjectRepository;
  readonly users: UserRepository;
  readonly artifacts: ArtifactRepository;
  readonly audit: AuditRepository;
  readonly reviews: ReviewRepository;
  /**
   * Apply a review decision as ONE transaction so a governed state change can
   * never be left without its audit row (the 'every action audited' invariant).
   */
  applyReviewDecision(write: ReviewDecisionWrite): Promise<Artifact | null>;
  close(): Promise<void>;
}
