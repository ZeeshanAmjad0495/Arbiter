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
import type {
  ArtifactRepository,
  AuditRepository,
  DemaskRepository,
  ExecutionRepository,
  GraphRepository,
  MembershipRepository,
  KnowledgeRepository,
  ProjectRepository,
  RepositoryBundle,
  ReviewRepository,
  SchemaRepository,
  SessionRepository,
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
    async list() {
      return [...users.values()];
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
    async listByProject(projectId: ProjectId) {
      return audit.filter((e) => e.projectId === projectId);
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
    async listByProject(projectId) {
      return reviews.filter((r) => r.projectId === projectId);
    },
  };

  const knowledgeDocs = new Map<string, KnowledgeDocument>();
  const knowledgeChunks: KnowledgeChunk[] = [];
  const chunkEmbeddings = new Map<string, number[]>();
  const knowledgeRepo: KnowledgeRepository = {
    async addDocument(doc: KnowledgeDocument, chunks: KnowledgeChunk[]) {
      knowledgeDocs.set(doc.id, doc);
      for (const c of chunks) knowledgeChunks.push(c);
      return doc;
    },
    async listDocuments(projectId: ProjectId) {
      return [...knowledgeDocs.values()]
        .filter((d) => d.projectId === projectId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async deleteDocument(projectId: ProjectId, docId: KnowledgeDocId) {
      const doc = knowledgeDocs.get(docId);
      if (!doc || doc.projectId !== projectId) return false;
      knowledgeDocs.delete(docId);
      for (let i = knowledgeChunks.length - 1; i >= 0; i--) {
        if (knowledgeChunks[i]!.docId === docId) knowledgeChunks.splice(i, 1);
      }
      return true;
    },
    async listChunks(projectId: ProjectId) {
      return knowledgeChunks.filter((c) => c.projectId === projectId);
    },
    async setChunkEmbedding(_projectId: ProjectId, chunkId: KnowledgeChunkId, embedding: number[]) {
      chunkEmbeddings.set(chunkId, embedding);
    },
    async searchByEmbedding(projectId: ProjectId, embedding: number[], k: number) {
      // Vectors are unit-normalized, so cosine similarity == dot product.
      const scored = knowledgeChunks
        .filter((c) => c.projectId === projectId && chunkEmbeddings.has(c.id))
        .map((chunk) => {
          const emb = chunkEmbeddings.get(chunk.id)!;
          let dot = 0;
          for (let i = 0; i < embedding.length; i++) dot += embedding[i]! * (emb[i] ?? 0);
          return { chunk, score: dot };
        })
        .sort((a, b) => b.score - a.score);
      return scored.slice(0, k);
    },
  };

  const projectSchemas: ProjectSchema[] = [];
  const schemaRepo: SchemaRepository = {
    async add(schema: ProjectSchema) {
      projectSchemas.push(schema);
      return schema;
    },
    async list(projectId: ProjectId) {
      return projectSchemas.filter((s) => s.projectId === projectId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    },
    async get(projectId: ProjectId, id: ProjectSchemaId) {
      return projectSchemas.find((s) => s.projectId === projectId && s.id === id) ?? null;
    },
    async delete(projectId: ProjectId, id: ProjectSchemaId) {
      const i = projectSchemas.findIndex((s) => s.projectId === projectId && s.id === id);
      if (i < 0) return false;
      projectSchemas.splice(i, 1);
      return true;
    },
  };

  const sessionList: Session[] = [];
  const sessionRepo: SessionRepository = {
    async create(session: Session) {
      sessionList.push(session);
      return session;
    },
    async getByTokenHash(tokenHash: string) {
      return sessionList.find((s) => s.tokenHash === tokenHash) ?? null;
    },
    async delete(id: SessionId) {
      const i = sessionList.findIndex((s) => s.id === id);
      if (i >= 0) sessionList.splice(i, 1);
    },
    async deleteExpired(nowIso: string) {
      let removed = 0;
      for (let i = sessionList.length - 1; i >= 0; i--) {
        if (sessionList[i]!.expiresAt < nowIso) {
          sessionList.splice(i, 1);
          removed++;
        }
      }
      return removed;
    },
  };

  let graphNodes: GraphNode[] = [];
  let graphEdges: GraphEdge[] = [];
  const graphRepo: GraphRepository = {
    async replaceGraph(projectId: ProjectId, nodes: GraphNode[], edges: GraphEdge[]) {
      graphNodes = graphNodes.filter((n) => n.projectId !== projectId).concat(nodes);
      graphEdges = graphEdges.filter((e) => e.projectId !== projectId).concat(edges);
    },
    async listNodes(projectId: ProjectId) {
      return graphNodes.filter((n) => n.projectId === projectId);
    },
    async listEdges(projectId: ProjectId) {
      return graphEdges.filter((e) => e.projectId === projectId);
    },
  };

  // De-mask vault: ciphertext keyed by `projectId::placeholder`; per-(project,type) counters.
  const demaskEntries = new Map<string, { cipher: Uint8Array; type: string; createdAtMs: number }>();
  const demaskCounters = new Map<string, number>();
  const demaskRepo: DemaskRepository = {
    async store(projectId: ProjectId, type: string, cipher: Uint8Array, createdAtMs: number) {
      const ckey = `${projectId}::${type}`;
      const n = (demaskCounters.get(ckey) ?? 0) + 1;
      demaskCounters.set(ckey, n);
      const placeholder = `[${type}_${n}]`;
      demaskEntries.set(`${projectId}::${placeholder}`, { cipher, type, createdAtMs });
      return placeholder;
    },
    async getCipher(projectId: ProjectId, placeholder: string) {
      const entry = demaskEntries.get(`${projectId}::${placeholder}`);
      return entry ? { cipher: entry.cipher, type: entry.type } : null;
    },
    async exportOlderThan(projectId: ProjectId, cutoffMs: number) {
      const rows: { placeholder: string; type: string; cipher: Uint8Array; createdAtMs: number }[] = [];
      const prefix = `${projectId}::`;
      for (const [k, v] of demaskEntries) {
        if (k.startsWith(prefix) && v.createdAtMs < cutoffMs) rows.push({ placeholder: k.slice(prefix.length), type: v.type, cipher: v.cipher, createdAtMs: v.createdAtMs });
      }
      return rows;
    },
    async purgeOlderThan(projectId: ProjectId, cutoffMs: number) {
      let removed = 0;
      for (const [k, v] of demaskEntries) {
        if (k.startsWith(`${projectId}::`) && v.createdAtMs < cutoffMs) {
          demaskEntries.delete(k);
          removed++;
        }
      }
      return removed;
    },
    async count(projectId: ProjectId) {
      let n = 0;
      for (const k of demaskEntries.keys()) if (k.startsWith(`${projectId}::`)) n++;
      return n;
    },
  };

  const executions: TestExecution[] = [];
  const executionRepo: ExecutionRepository = {
    async create(exec: TestExecution) {
      executions.push(exec);
      return exec;
    },
    async listByProject(projectId: ProjectId, limit = 50) {
      return executions
        .filter((e) => e.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    },
  };

  const memberships = new Set<string>(); // `${projectId}::${userId}`
  const mkey = (p: string, u: string) => `${p}::${u}`;
  const memberRepo: MembershipRepository = {
    async grant(projectId, userId) {
      memberships.add(mkey(projectId, userId));
    },
    async revoke(projectId, userId) {
      memberships.delete(mkey(projectId, userId));
    },
    async isMember(projectId, userId) {
      return memberships.has(mkey(projectId, userId));
    },
    async projectsForUser(userId) {
      return [...memberships].filter((k) => k.endsWith(`::${userId}`)).map((k) => k.split('::')[0] as ProjectId);
    },
    async usersForProject(projectId) {
      return [...memberships].filter((k) => k.startsWith(`${projectId}::`)).map((k) => k.split('::')[1] as UserId);
    },
  };

  return {
    kind: 'memory',
    projects: projectRepo,
    users: userRepo,
    sessions: sessionRepo,
    members: memberRepo,
    graph: graphRepo,
    artifacts: artifactRepo,
    audit: auditRepo,
    reviews: reviewRepo,
    knowledge: knowledgeRepo,
    schemas: schemaRepo,
    demask: demaskRepo,
    executions: executionRepo,
    async applyReviewDecision(write) {
      const updated = await artifactRepo.update(write.projectId, write.artifactId, {
        status: write.status,
        ...(write.content !== undefined ? { content: write.content } : {}),
      });
      if (!updated) return null;
      await reviewRepo.append(write.review);
      await auditRepo.append(write.audit);
      return updated;
    },
    async close() {
      /* nothing to close */
    },
  };
}
