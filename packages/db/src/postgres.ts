import pg from 'pg';
import type { Pool as PgPool, PoolClient } from 'pg';
import {
  Artifact,
  type ArtifactId,
  AuditEvent,
  Project,
  type ProjectId,
  ReviewLog,
  User,
  type WorkflowRunId,
} from '@arbiter/core';
import type {
  ArtifactRepository,
  AuditRepository,
  ProjectRepository,
  RepositoryBundle,
  ReviewRepository,
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

  const projects: ProjectRepository = {
    async upsert(project) {
      await pool.query(
        `INSERT INTO projects (id, name, classification, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, classification = EXCLUDED.classification`,
        [project.id, project.name, project.classification, project.createdAt],
      );
      return project;
    },
    async get(id) {
      const { rows } = await pool.query('SELECT id, name, classification, created_at FROM projects WHERE id = $1', [id]);
      const row = rows[0];
      if (!row) return null;
      return Project.parse({ id: row.id, name: row.name, classification: row.classification, createdAt: iso(row.created_at) });
    },
    async list() {
      const { rows } = await pool.query('SELECT id, name, classification, created_at FROM projects ORDER BY created_at');
      return rows.map((row) =>
        Project.parse({ id: row.id, name: row.name, classification: row.classification, createdAt: iso(row.created_at) }),
      );
    },
  };

  const users: UserRepository = {
    async upsert(user) {
      await pool.query(
        `INSERT INTO users (id, email, role, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role`,
        [user.id, user.email, user.role, user.createdAt],
      );
      return user;
    },
    async get(id) {
      const { rows } = await pool.query('SELECT id, email, role, created_at FROM users WHERE id = $1', [id]);
      const row = rows[0];
      if (!row) return null;
      return User.parse({ id: row.id, email: row.email, role: row.role, createdAt: iso(row.created_at) });
    },
    async getByEmail(email) {
      const { rows } = await pool.query('SELECT id, email, role, created_at FROM users WHERE email = $1', [email]);
      const row = rows[0];
      if (!row) return null;
      return User.parse({ id: row.id, email: row.email, role: row.role, createdAt: iso(row.created_at) });
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
  };

  const ARTIFACT_COLS =
    'id, project_id, workflow_run_id, type, status, risk_tier, content, prompt_version, model, created_by, created_at';

  return {
    kind: 'postgres',
    projects,
    users,
    artifacts,
    audit,
    reviews,
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
