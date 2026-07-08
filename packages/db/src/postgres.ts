import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
import {
  Artifact,
  type ArtifactId,
  AuditEvent,
  GraphEdge,
  GraphNode,
  KnowledgeChunk,
  type KnowledgeDocId,
  KnowledgeDocument,
  Project,
  type ProjectId,
  ProjectSchema,
  ReviewLog,
  Session,
  TestExecution,
  User,
  type UserId,
  type WorkflowRunId,
} from '@arbiter/core';
import type {
  ArtifactRepository,
  AuditRepository,
  DemaskRepository,
  ExecutionRepository,
  KnowledgeRepository,
  GraphRepository,
  MembershipRepository,
  ProjectRepository,
  RepositoryBundle,
  ReviewRepository,
  SchemaRepository,
  SessionRepository,
  UserRepository,
} from './types';

const { Pool } = pg;

/** GUC that RLS policies read. Set per-transaction via SET LOCAL. */
const PROJECT_GUC = 'app.arbiter_project_id';

/**
 * Runs `fn` inside a transaction with the project RLS context set. This is the
 * belt-and-suspenders isolation: the WHERE clauses are the primary filter, RLS
 * is the backstop that fails closed if a query ever forgets the filter.
 */
async function withProjectTx<T>(pool: PgPool, projectId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config(name, value, is_local=true) === SET LOCAL — scoped to this tx.
    await client.query('SELECT set_config($1, $2, true)', [PROJECT_GUC, projectId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const iso = (value: Date | string): string => (value instanceof Date ? value.toISOString() : value);

export function createPostgresRepositories(databaseUrl: string): RepositoryBundle {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 10,
    // Fail fast instead of hanging forever when the pool is saturated or a
    // transaction stalls (prevents a single stall from becoming an app-wide block).
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    idle_in_transaction_session_timeout: 30_000,
  });

  const PROJECT_COLS = 'id, name, classification, description, repo_url, repo_path, created_at';
  const rowToProject = (row: Record<string, unknown>): Project =>
    Project.parse({
      id: row.id,
      name: row.name,
      classification: row.classification,
      description: row.description ?? undefined,
      repoUrl: row.repo_url ?? undefined,
      repoPath: row.repo_path ?? undefined,
      createdAt: iso(row.created_at as Date | string),
    });

  const projects: ProjectRepository = {
    async upsert(project) {
      await pool.query(
        `INSERT INTO projects (id, name, classification, description, repo_url, repo_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, classification = EXCLUDED.classification,
           description = EXCLUDED.description, repo_url = EXCLUDED.repo_url, repo_path = EXCLUDED.repo_path`,
        [project.id, project.name, project.classification, project.description ?? null, project.repoUrl ?? null, project.repoPath ?? null, project.createdAt],
      );
      return project;
    },
    async get(id) {
      const { rows } = await pool.query(`SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`, [id]);
      return rows[0] ? rowToProject(rows[0]) : null;
    },
    async list() {
      const { rows } = await pool.query(`SELECT ${PROJECT_COLS} FROM projects ORDER BY created_at`);
      return rows.map(rowToProject);
    },
  };

  const schemas: SchemaRepository = {
    async add(schema) {
      await withProjectTx(pool, schema.projectId, (client) =>
        client.query(`INSERT INTO project_schemas (id, project_id, name, schema, created_at) VALUES ($1, $2, $3, $4, $5)`, [
          schema.id,
          schema.projectId,
          schema.name,
          JSON.stringify(schema.schema ?? null),
          schema.createdAt,
        ]),
      );
      return schema;
    },
    async list(projectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(`SELECT id, project_id, name, schema, created_at FROM project_schemas WHERE project_id = $1 ORDER BY created_at DESC`, [projectId]);
        return rows.map(rowToSchema);
      });
    },
    async get(projectId, id) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(`SELECT id, project_id, name, schema, created_at FROM project_schemas WHERE project_id = $1 AND id = $2`, [projectId, id]);
        return rows[0] ? rowToSchema(rows[0]) : null;
      });
    },
    async delete(projectId, id) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rowCount } = await client.query(`DELETE FROM project_schemas WHERE project_id = $1 AND id = $2`, [projectId, id]);
        return (rowCount ?? 0) > 0;
      });
    },
  };

  const rowToUser = (row: Record<string, unknown>): User =>
    User.parse({
      id: row.id,
      email: row.email,
      role: row.role,
      accessKeyHash: row.access_key_hash ?? undefined,
      createdAt: iso(row.created_at as Date | string),
    });

  const users: UserRepository = {
    async upsert(user) {
      await pool.query(
        `INSERT INTO users (id, email, role, access_key_hash, created_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, access_key_hash = EXCLUDED.access_key_hash`,
        [user.id, user.email, user.role, user.accessKeyHash ?? null, user.createdAt],
      );
      return user;
    },
    async get(id) {
      const { rows } = await pool.query('SELECT id, email, role, access_key_hash, created_at FROM users WHERE id = $1', [id]);
      return rows[0] ? rowToUser(rows[0]) : null;
    },
    async getByEmail(email) {
      const { rows } = await pool.query('SELECT id, email, role, access_key_hash, created_at FROM users WHERE email = $1', [email]);
      return rows[0] ? rowToUser(rows[0]) : null;
    },
    async list() {
      const { rows } = await pool.query('SELECT id, email, role, access_key_hash, created_at FROM users ORDER BY created_at');
      return rows.map(rowToUser);
    },
  };

  const members: MembershipRepository = {
    async grant(projectId, userId) {
      await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [projectId, userId]);
    },
    async revoke(projectId, userId) {
      await pool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
    },
    async isMember(projectId, userId) {
      const { rows } = await pool.query('SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2', [projectId, userId]);
      return rows.length > 0;
    },
    async projectsForUser(userId) {
      const { rows } = await pool.query('SELECT project_id FROM project_members WHERE user_id = $1', [userId]);
      return rows.map((r) => r.project_id as ProjectId);
    },
    async usersForProject(projectId) {
      const { rows } = await pool.query('SELECT user_id FROM project_members WHERE project_id = $1', [projectId]);
      return rows.map((r) => r.user_id as UserId);
    },
  };

  const sessions: SessionRepository = {
    async create(session) {
      await pool.query('INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)', [
        session.id,
        session.userId,
        session.tokenHash,
        session.createdAt,
        session.expiresAt,
      ]);
      return session;
    },
    async getByTokenHash(tokenHash) {
      const { rows } = await pool.query('SELECT id, user_id, token_hash, created_at, expires_at FROM sessions WHERE token_hash = $1', [tokenHash]);
      const row = rows[0];
      if (!row) return null;
      return Session.parse({
        id: row.id,
        userId: row.user_id,
        tokenHash: row.token_hash,
        createdAt: iso(row.created_at as Date | string),
        expiresAt: iso(row.expires_at as Date | string),
      });
    },
    async delete(id) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
    },
    async deleteExpired(nowIso) {
      const { rowCount } = await pool.query('DELETE FROM sessions WHERE expires_at < $1', [nowIso]);
      return rowCount ?? 0;
    },
  };

  const artifacts: ArtifactRepository = {
    async create(artifact) {
      await withProjectTx(pool, artifact.projectId, (client) =>
        client.query(
          `INSERT INTO artifacts (id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            artifact.id,
            artifact.projectId,
            artifact.workflowRunId,
            artifact.type,
            artifact.status,
            artifact.riskTier,
            JSON.stringify(artifact.content ?? null),
            artifact.promptVersion ?? null,
            artifact.model ?? null,
            artifact.createdBy,
            artifact.createdAt,
          ],
        ),
      );
      return artifact;
    },
    async get(projectId: ProjectId, id: ArtifactId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at
           FROM artifacts WHERE project_id = $1 AND id = $2`,
          [projectId, id],
        );
        const row = rows[0];
        if (!row) return null;
        return rowToArtifact(row);
      });
    },
    async listByRun(projectId: ProjectId, runId: WorkflowRunId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at
           FROM artifacts WHERE project_id = $1 AND workflow_run_id = $2 ORDER BY created_at`,
          [projectId, runId],
        );
        return rows.map(rowToArtifact);
      });
    },
    async listByStatus(projectId, statuses) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at
           FROM artifacts WHERE project_id = $1 AND status = ANY($2) ORDER BY created_at DESC`,
          [projectId, statuses],
        );
        return rows.map(rowToArtifact);
      });
    },
    async update(projectId, id, patch) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } =
          patch.content !== undefined
            ? await client.query(
                `UPDATE artifacts SET status = $3, content = $4 WHERE project_id = $1 AND id = $2
                 RETURNING id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at`,
                [projectId, id, patch.status, JSON.stringify(patch.content ?? null)],
              )
            : await client.query(
                `UPDATE artifacts SET status = $3 WHERE project_id = $1 AND id = $2
                 RETURNING id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at`,
                [projectId, id, patch.status],
              );
        const row = rows[0];
        return row ? rowToArtifact(row) : null;
      });
    },
  };

  const audit: AuditRepository = {
    async append(event) {
      await withProjectTx(pool, event.projectId, (client) =>
        client.query(
          `INSERT INTO audit_events (id, project_id, actor_id, workflow_run_id, action, input_sha256, prompt_version, model, sources, detail, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            event.id,
            event.projectId,
            event.actorId,
            event.workflowRunId,
            event.action,
            event.inputSha256 ?? null,
            event.promptVersion ?? null,
            event.model ?? null,
            JSON.stringify(event.sources),
            JSON.stringify(event.detail),
            event.createdAt,
          ],
        ),
      );
      return event;
    },
    async listByRun(projectId: ProjectId, runId: WorkflowRunId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, actor_id, workflow_run_id, action, input_sha256, prompt_version, model, sources, detail, created_at
           FROM audit_events WHERE project_id = $1 AND workflow_run_id = $2 ORDER BY created_at`,
          [projectId, runId],
        );
        return rows.map(rowToAuditEvent);
      });
    },
    async listByProject(projectId: ProjectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, actor_id, workflow_run_id, action, input_sha256, prompt_version, model, sources, detail, created_at
           FROM audit_events WHERE project_id = $1 ORDER BY created_at`,
          [projectId],
        );
        return rows.map(rowToAuditEvent);
      });
    },
  };

  const reviews: ReviewRepository = {
    async append(review) {
      await withProjectTx(pool, review.projectId, (client) =>
        client.query(
          `INSERT INTO reviews (id, project_id, artifact_id, decision, mode, risk_tier, reviewer, edit_diff, dwell_ms, decided_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            review.id,
            review.projectId,
            review.artifactId,
            review.decision,
            review.mode,
            review.riskTier,
            review.reviewer ?? null,
            review.editDiff ?? null,
            review.dwellMs ?? null,
            review.decidedAt ?? null,
            review.createdAt,
          ],
        ),
      );
      return review;
    },
    async listByArtifact(projectId, artifactId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, artifact_id, decision, mode, risk_tier, reviewer, edit_diff, dwell_ms, decided_at, created_at
           FROM reviews WHERE project_id = $1 AND artifact_id = $2 ORDER BY created_at`,
          [projectId, artifactId],
        );
        return rows.map(rowToReview);
      });
    },
    async listByProject(projectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, artifact_id, decision, mode, risk_tier, reviewer, edit_diff, dwell_ms, decided_at, created_at
           FROM reviews WHERE project_id = $1 ORDER BY created_at`,
          [projectId],
        );
        return rows.map(rowToReview);
      });
    },
  };

  const ARTIFACT_COLS =
    'id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at';

  const knowledge: KnowledgeRepository = {
    async addDocument(doc: KnowledgeDocument, chunks: KnowledgeChunk[]) {
      await withProjectTx(pool, doc.projectId, async (client) => {
        await client.query(
          `INSERT INTO knowledge_documents (id, project_id, title, source_type, citation, classification, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [doc.id, doc.projectId, doc.title, doc.sourceType, doc.citation, doc.classification, doc.createdAt],
        );
        for (const c of chunks) {
          await client.query(
            `INSERT INTO knowledge_chunks (id, project_id, doc_id, ordinal, content, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
            [c.id, c.projectId, c.docId, c.ordinal, c.content, c.createdAt],
          );
        }
      });
      return doc;
    },
    async listDocuments(projectId: ProjectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, title, source_type, citation, classification, created_at
           FROM knowledge_documents WHERE project_id = $1 ORDER BY created_at DESC`,
          [projectId],
        );
        return rows.map(rowToKnowledgeDoc);
      });
    },
    async deleteDocument(projectId: ProjectId, docId: KnowledgeDocId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rowCount } = await client.query(`DELETE FROM knowledge_documents WHERE project_id = $1 AND id = $2`, [projectId, docId]);
        return (rowCount ?? 0) > 0;
      });
    },
    async listChunks(projectId: ProjectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, doc_id, ordinal, content, created_at FROM knowledge_chunks WHERE project_id = $1 ORDER BY doc_id, ordinal`,
          [projectId],
        );
        return rows.map(rowToKnowledgeChunk);
      });
    },
    async setChunkEmbedding(projectId, chunkId, embedding) {
      await withProjectTx(pool, projectId, (client) =>
        // pgvector reads the vector from its text form `[a,b,c]`.
        client.query('UPDATE knowledge_chunks SET embedding = $3::vector WHERE project_id = $1 AND id = $2', [projectId, chunkId, `[${embedding.join(',')}]`]),
      );
    },
    async searchByEmbedding(projectId, embedding, k) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, doc_id, ordinal, content, created_at, 1 - (embedding <=> $2::vector) AS score
           FROM knowledge_chunks WHERE project_id = $1 AND embedding IS NOT NULL
           ORDER BY embedding <=> $2::vector LIMIT $3`,
          [projectId, `[${embedding.join(',')}]`, k],
        );
        return rows.map((r) => ({ chunk: rowToKnowledgeChunk(r), score: Number(r.score) }));
      });
    },
  };

  const graph: GraphRepository = {
    async replaceGraph(projectId, nodes, edges) {
      await withProjectTx(pool, projectId, async (client) => {
        await client.query('DELETE FROM graph_edges WHERE project_id = $1', [projectId]);
        await client.query('DELETE FROM graph_nodes WHERE project_id = $1', [projectId]);
        for (const n of nodes) {
          await client.query('INSERT INTO graph_nodes (id, project_id, label, type, mentions, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
            n.id,
            n.projectId,
            n.label,
            n.type,
            n.mentions,
            n.createdAt,
          ]);
        }
        for (const e of edges) {
          await client.query('INSERT INTO graph_edges (id, project_id, source_id, target_id, relation, weight, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
            e.id,
            e.projectId,
            e.sourceId,
            e.targetId,
            e.relation,
            e.weight,
            e.createdAt,
          ]);
        }
      });
    },
    async listNodes(projectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query('SELECT id, project_id, label, type, mentions, created_at FROM graph_nodes WHERE project_id = $1', [projectId]);
        return rows.map(rowToGraphNode);
      });
    },
    async listEdges(projectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query('SELECT id, project_id, source_id, target_id, relation, weight, created_at FROM graph_edges WHERE project_id = $1', [projectId]);
        return rows.map(rowToGraphEdge);
      });
    },
  };

  const demask: DemaskRepository = {
    async store(projectId, type, cipher, createdAtMs) {
      return withProjectTx(pool, projectId, async (client) => {
        // Atomic counter bump + insert in one tx — two concurrent sanitize()
        // calls can never mint the same [TYPE_n].
        const { rows } = await client.query(
          `INSERT INTO demask_counters (project_id, finding_type, n) VALUES ($1, $2, 1)
           ON CONFLICT (project_id, finding_type) DO UPDATE SET n = demask_counters.n + 1
           RETURNING n`,
          [projectId, type],
        );
        const placeholder = `[${type}_${rows[0]!.n}]`;
        await client.query('INSERT INTO demask_entries (project_id, placeholder, finding_type, cipher, created_at_ms) VALUES ($1,$2,$3,$4,$5)', [
          projectId,
          placeholder,
          type,
          Buffer.from(cipher),
          createdAtMs,
        ]);
        return placeholder;
      });
    },
    async getCipher(projectId, placeholder) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query('SELECT cipher, finding_type FROM demask_entries WHERE project_id = $1 AND placeholder = $2', [projectId, placeholder]);
        if (rows.length === 0) return null;
        return { cipher: rows[0]!.cipher as Uint8Array, type: rows[0]!.finding_type as string };
      });
    },
    async exportOlderThan(projectId, cutoffMs) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query('SELECT placeholder, finding_type, cipher, created_at_ms FROM demask_entries WHERE project_id = $1 AND created_at_ms < $2', [projectId, cutoffMs]);
        return rows.map((r) => ({ placeholder: r.placeholder as string, type: r.finding_type as string, cipher: r.cipher as Uint8Array, createdAtMs: Number(r.created_at_ms) }));
      });
    },
    async purgeOlderThan(projectId, cutoffMs) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rowCount } = await client.query('DELETE FROM demask_entries WHERE project_id = $1 AND created_at_ms < $2', [projectId, cutoffMs]);
        return rowCount ?? 0;
      });
    },
    async count(projectId) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query('SELECT count(*)::int AS n FROM demask_entries WHERE project_id = $1', [projectId]);
        return rows[0]!.n as number;
      });
    },
  };

  const executions: ExecutionRepository = {
    async create(exec) {
      return withProjectTx(pool, exec.projectId, async (client) => {
        await client.query(
          `INSERT INTO executions (id, project_id, kind, name, mode, status, summary, cases, exit_code, error, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            exec.id,
            exec.projectId,
            exec.kind,
            exec.name,
            exec.mode,
            exec.status,
            JSON.stringify(exec.summary),
            JSON.stringify(exec.cases),
            exec.exitCode,
            exec.error ?? null,
            exec.createdAt,
          ],
        );
        return exec;
      });
    },
    async listByProject(projectId, limit = 50) {
      return withProjectTx(pool, projectId, async (client) => {
        const { rows } = await client.query(
          `SELECT id, project_id, kind, name, mode, status, summary, cases, exit_code, error, created_at
           FROM executions WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2`,
          [projectId, limit],
        );
        return rows.map(rowToExecution);
      });
    },
  };

  return {
    kind: 'postgres',
    projects,
    users,
    sessions,
    graph,
    artifacts,
    audit,
    reviews,
    knowledge,
    schemas,
    demask,
    executions,
    members,
    async applyReviewDecision(write) {
      return withProjectTx(pool, write.projectId, async (client) => {
        const { rows } =
          write.content !== undefined
            ? await client.query(
                `UPDATE artifacts SET status = $3, content = $4 WHERE project_id = $1 AND id = $2 RETURNING ${ARTIFACT_COLS}`,
                [write.projectId, write.artifactId, write.status, JSON.stringify(write.content ?? null)],
              )
            : await client.query(
                `UPDATE artifacts SET status = $3 WHERE project_id = $1 AND id = $2 RETURNING ${ARTIFACT_COLS}`,
                [write.projectId, write.artifactId, write.status],
              );
        const row = rows[0];
        if (!row) return null;
        const r = write.review;
        await client.query(
          `INSERT INTO reviews (id, project_id, artifact_id, decision, mode, risk_tier, reviewer, edit_diff, dwell_ms, decided_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [r.id, r.projectId, r.artifactId, r.decision, r.mode, r.riskTier, r.reviewer ?? null, r.editDiff ?? null, r.dwellMs ?? null, r.decidedAt ?? null, r.createdAt],
        );
        const a = write.audit;
        await client.query(
          `INSERT INTO audit_events (id, project_id, actor_id, workflow_run_id, action, input_sha256, prompt_version, model, sources, detail, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [a.id, a.projectId, a.actorId, a.workflowRunId, a.action, a.inputSha256 ?? null, a.promptVersion ?? null, a.model ?? null, JSON.stringify(a.sources), JSON.stringify(a.detail), a.createdAt],
        );
        return rowToArtifact(row);
      });
    },
    async close() {
      await pool.end();
    },
  };
}

function rowToReview(row: Record<string, unknown>): ReviewLog {
  return ReviewLog.parse({
    id: row.id,
    projectId: row.project_id,
    artifactId: row.artifact_id,
    decision: row.decision,
    mode: row.mode,
    riskTier: row.risk_tier,
    reviewer: row.reviewer ?? undefined,
    editDiff: row.edit_diff ?? undefined,
    dwellMs: row.dwell_ms ?? undefined,
    decidedAt: row.decided_at ? iso(row.decided_at as Date | string) : undefined,
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToArtifact(row: Record<string, unknown>): Artifact {
  return Artifact.parse({
    id: row.id,
    projectId: row.project_id,
    workflowRunId: row.workflow_run_id,
    type: row.type,
    status: row.status,
    riskTier: row.risk_tier ?? 'medium',
    // node-pg auto-parses jsonb — do NOT re-parse (a stored string scalar would
    // otherwise throw or be coerced to a number/bool/array).
    content: row.content,
    promptVersion: row.prompt_version ?? undefined,
    model: row.model ?? undefined,
    createdBy: row.created_by,
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToAuditEvent(row: Record<string, unknown>): AuditEvent {
  return AuditEvent.parse({
    id: row.id,
    projectId: row.project_id,
    actorId: row.actor_id,
    workflowRunId: row.workflow_run_id,
    action: row.action,
    inputSha256: row.input_sha256 ?? undefined,
    promptVersion: row.prompt_version ?? undefined,
    model: row.model ?? undefined,
    // node-pg auto-parses jsonb.
    sources: row.sources ?? [],
    detail: row.detail ?? {},
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToKnowledgeDoc(row: Record<string, unknown>): KnowledgeDocument {
  return KnowledgeDocument.parse({
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    sourceType: row.source_type,
    citation: row.citation,
    classification: row.classification,
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToGraphNode(row: Record<string, unknown>): GraphNode {
  return GraphNode.parse({
    id: row.id,
    projectId: row.project_id,
    label: row.label,
    type: row.type,
    mentions: row.mentions,
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToGraphEdge(row: Record<string, unknown>): GraphEdge {
  return GraphEdge.parse({
    id: row.id,
    projectId: row.project_id,
    sourceId: row.source_id,
    targetId: row.target_id,
    relation: row.relation,
    weight: row.weight,
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToExecution(row: Record<string, unknown>): TestExecution {
  return TestExecution.parse({
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    name: row.name,
    mode: row.mode,
    status: row.status,
    summary: row.summary, // node-pg auto-parses jsonb
    cases: row.cases,
    exitCode: row.exit_code,
    ...(row.error != null ? { error: row.error } : {}),
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToSchema(row: Record<string, unknown>): ProjectSchema {
  return ProjectSchema.parse({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    schema: row.schema, // node-pg auto-parses jsonb
    createdAt: iso(row.created_at as Date | string),
  });
}

function rowToKnowledgeChunk(row: Record<string, unknown>): KnowledgeChunk {
  return KnowledgeChunk.parse({
    id: row.id,
    projectId: row.project_id,
    docId: row.doc_id,
    ordinal: row.ordinal,
    content: row.content,
    createdAt: iso(row.created_at as Date | string),
  });
}
