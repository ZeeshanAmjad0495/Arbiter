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
import type {
  ArtifactRepository,
  AuditRepository,
  ProjectRepository,
  RepositoryBundle,
  ReviewRepository,
  UserRepository,
} from './types';

/**
 * In-memory repositories. Powers offline `pnpm hello`, unit tests, and CI.
 * Enforces the same project-scoping contract as Postgres so tests catch
 * cross-tenant leaks that would otherwise only surface against a real DB.
 */
export function createMemoryRepositories(): RepositoryBundle {
  const projects = new Map<string, Project>();
  const users = new Map<string, User>();
  const artifacts = new Map<string, Artifact>();
  const audit: AuditEvent[] = [];
  const reviews: ReviewLog[] = [];

  const projectRepo: ProjectRepository = {
    async upsert(project) {
      projects.set(project.id, project);
      return project;
    },
    async get(id) {
      return projects.get(id) ?? null;
    },
    async list() {
      return [...projects.values()];
    },
  };

  const userRepo: UserRepository = {
    async upsert(user) {
      users.set(user.id, user);
      return user;
    },
    async get(id) {
      return users.get(id) ?? null;
    },
    async getByEmail(email) {
      for (const user of users.values()) {
        if (user.email === email) return user;
      }
      return null;
    },
  };

  const artifactRepo: ArtifactRepository = {
    async create(artifact) {
      artifacts.set(artifact.id, artifact);
      return artifact;
    },
    async get(projectId: ProjectId, id: ArtifactId) {
      const found = artifacts.get(id);
      return found && found.projectId === projectId ? found : null;
    },
    async listByRun(projectId: ProjectId, runId: WorkflowRunId) {
      return [...artifacts.values()].filter((a) => a.projectId === projectId && a.workflowRunId === runId);
    },
    async listByStatus(projectId: ProjectId, statuses: ArtifactStatus[]) {
      const set = new Set(statuses);
      return [...artifacts.values()]
        .filter((a) => a.projectId === projectId && set.has(a.status))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async update(projectId, id, patch) {
      const found = artifacts.get(id);
      if (!found || found.projectId !== projectId) return null;
      const updated: Artifact = {
        ...found,
        status: patch.status,
        ...(patch.content !== undefined ? { content: patch.content } : {}),
      };
      artifacts.set(id, updated);
      return updated;
    },
  };

  const auditRepo: AuditRepository = {
    async append(event) {
      audit.push(event);
      return event;
    },
    async listByRun(projectId: ProjectId, runId: WorkflowRunId) {
      return audit.filter((e) => e.projectId === projectId && e.workflowRunId === runId);
    },
  };

  const reviewRepo: ReviewRepository = {
    async append(review) {
      reviews.push(review);
      return review;
    },
    async listByArtifact(projectId, artifactId) {
      return reviews.filter((r) => r.projectId === projectId && r.artifactId === artifactId);
    },
  };

  return {
    kind: 'memory',
    projects: projectRepo,
    users: userRepo,
    artifacts: artifactRepo,
    audit: auditRepo,
    reviews: reviewRepo,
    async close() {
      /* nothing to close */
    },
  };
}
