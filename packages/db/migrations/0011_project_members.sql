-- Per-user project access. An admin marks which users may see/select which
-- projects; non-admins can only access projects they're a member of. This is
-- access-control infrastructure (queried across projects and by user), so it is
-- NOT project-RLS-scoped — like the sessions/users tables. Admins bypass it.

CREATE TABLE IF NOT EXISTS project_members (
  project_id uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user_idx ON project_members (user_id);
