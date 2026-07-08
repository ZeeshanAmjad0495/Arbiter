# Self-hosted observability (free/OSS)

Read-only ground sources for Arbiter — **no paid services**. Grafana (+ Loki logs +
Prometheus metrics) and GlitchTip (a lightweight, Sentry-API-compatible error tracker
that Arbiter's Sentry connector works against unchanged).

## Bring it up

```bash
docker compose -f docker-compose.observability.yml up -d
```

| Service | URL | Purpose |
| --- | --- | --- |
| Grafana | http://localhost:3001 (admin / admin) | dashboards, alerts; Loki logs + Prometheus metrics datasources are auto-provisioned |
| GlitchTip | http://localhost:8080 | Sentry-compatible errors |
| Prometheus | http://localhost:9090 | metrics |
| Loki | http://localhost:3100 | logs |

Everything is **read-only** from Arbiter's side (the connectors are GET-only and cannot
mutate), and the tokens below are read-only too — defense in depth.

## Tokens → `.env`

**Grafana** (already wired by setup): a **Viewer** service-account token.
Create another via *Administration → Service accounts → Add* (role Viewer) → *Add token*.

```
GRAFANA_URL=http://localhost:3001
GRAFANA_TOKEN=glsa_…
```

**GlitchTip / Sentry** (one-time, ~2 min in the UI):
1. Open http://localhost:8080 → **Register** (open registration is enabled).
2. Create an **Organization** (its slug is your `SENTRY_ORG`).
3. Profile → **Auth Tokens** → create one with read scopes (`event:read`, `project:read`, `org:read`).

```
SENTRY_BASE_URL=http://localhost:8080
SENTRY_ORG=<your org slug>
SENTRY_AUTH_TOKEN=<the auth token>
```

## Ingest into a project (read-only)

```bash
DATABASE_URL=… pnpm ingest --project Zuub --observability
```

Only the observability docs are refreshed (GitHub/Jira context is left untouched). Run it
on a schedule to keep the operational context current.
