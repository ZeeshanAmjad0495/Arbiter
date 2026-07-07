# Arbiter Roadmap — Quality Engineering Workbench

> Re-planned around the QA→QE gap analysis (`docs/QA-GAP-ANALYSIS.md`). This replaces the original Phase 0–5 numbering with a value-ordered **Wave** roadmap. Framing: Arbiter is a **governed Quality Engineering workbench** — it *drafts, grounds, validates, and gates* QA/QE artifacts and reads *back* from execution/observability tools; it never runs suites, never releases, and never writes without a gate.

**Non-negotiable invariants (hold at every wave):** AI drafts · humans approve · every output grounded · every action auditable · every write gated · read-only default. **Arbiter never writes to the connected Jira workspace** (enforced in code — all Jira calls are read-only; any write method throws before a request is sent).

---

## Wave 0 — Shipped (the governed workbench)

The spine and MVP are built, hardened, and on `main`:

- Guardrail pipeline `sanitize → ground → generate → validate → gate` (offline-first, pluggable to Postgres/RLS, Presidio, Anthropic/Kimi).
- **7 workflows:** Requirement & Ambiguity Analyzer, Test Case Generator (+Gherkin), Edge-Case Challenger, Bug Report Drafter, Release Readiness Summarizer, NFR Completeness Analyzer, Operational-Readiness Gate.
- Review Queue (edit-diff + dwell capture), Export (MD/CSV/JSON/Gherkin), 6-component Prompt Library, code-based eval gate in CI.
- Read-only grounding sources: OpenAPI upload + **Jira fetch-by-key (read-only, org-scoped)**.
- Security/PHI/DB hardening (adversarially reviewed): credential hard-block, union-redaction, atomic audited writes, auth guard, context-pack sanitization.

---

## Enabling substrate (built just-in-time to unblock waves)

Not user-facing workflows; they feed the **ground** stage or compute over captured signals. Identity-consistent (read-only, no ungated write).

- **Per-project knowledge + hybrid retrieval (RAG):** knowledge store, per-source chunkers, Postgres FTS + app-side dense re-rank (pgvector-swappable), Context Pack Builder wired to retrieval → *project-aware generation, no re-pasting*. **Unblocks** Wave 2 (traceability corpus) and Wave 5 (cross-req, spec-change).
- **Read-only ground-source connectors:** Jira sync (read-only) ✓ · Confluence · observability (Datadog/Grafana/Sentry/Splunk) — ACL-mirrored, PII-sanitized. **Unblocks** Wave 3.
- **Quality Metrics Aggregation Layer:** deterministic aggregation over spans/edit-diffs/dwell/eval results → the real "quality trend line." **Unblocks** reporting/forecasting.
- **WriteGate:** diff-plan → named approval → apply → verify → audit. Read-only default. **Targets: GitHub / TestRail / Xray / a sandbox Jira ONLY — never the connected production Jira workspace.**
- **Source-vs-Output Validator:** field-level source↔output check (the documented 1.5h→2min win) — ships with the knowledge/data substrate.

---

## Wave 1 — Quick wins that extend shipped surface *(shipped ✓)*

| # | Item | Effort | Status |
|---|---|---|---|
| 1 | **Operational-Readiness Gate** (Release Readiness v2) | S | ✅ shipped — 14-category grounded checklist (SLOs/runbook/alerts/rollback/on-call/DR/kill-switch/dependencies), human-owned Go/No-Go |
| 2 | **NFR Completeness Analyzer** (extend Requirement Analyzer) | S | ✅ shipped — 15 NFR categories incl. data-integrity/compatibility/recoverability/auditability; drafts a testable AC per gap |
| 3 | **Grounded Release-Readiness inputs** | M | ✅ shipped — structured release signals rendered into the grounded context pack; cited pass ratios/percentages are grounding-validated (invented figures block export) |
| — | ~~Gated Defect Write-Back → Jira~~ | — | **Deferred** — conflicts with "never write to the connected Jira." Will target a sandbox Jira only, with explicit per-target authorization. |

## Wave 1.5 — Multi-Project Surface *(shipped ✓)*

The isolation spine was always multi-tenant (branded `ProjectId`, project-scoped repos, Postgres `FORCE ROW LEVEL SECURITY` with a per-transaction GUC); only the entry surface was pinned to one demo project. This slice exposes it:

- **Project CRUD** — `GET /v1/projects`, `POST /v1/projects`; a stable default project is provisioned idempotently at boot.
- **Per-request project scope** — the `x-arbiter-project` header resolves the acting project (falling back to the default) and is threaded into every repo call → RLS GUC per transaction. Invalid id → 400, unknown → 404.
- **UI project switcher** — header dropdown + create-new; selection persists and scopes every page.
- **HTTP-level isolation test** — `tests/projects.test.ts` proves one project cannot read another's review queue or artifacts.
- *Deferred:* per-**user** authorization of which projects a caller may select (arrives with SSO); per-project connector config (Jira/OpenAPI moving off global env) lands with the Wave 2 knowledge/connector substrate.

## Wave 2 — Core QE differentiators (the QA→QE leap) *(shipped ✓)*

- **Test Strategy Generator** — risk-based strategy (scope/out-of-scope, risk areas, test levels + automation split, environments, entry/exit); the umbrella a Test Plan traces to. Grounds an explicit `tracedIds` list (not scraped prose) so invented ids block export.
- **Test Plan Generator** — executable plan where **every scenario's `coversRiskArea` is grounded** against the strategy/requirements in context → enforced plan→strategy traceability.
- **Requirements Traceability & Coverage Matrix** — **id-aware**: requirement ids ↔ covering test ids, uncovered requirements + orphan tests; every id is grounding-checked.
- **Compliance Control-Mapping & Evidence Pack** — framework controls (HIPAA/SOC 2) → satisfied/gap + required evidence + verification; control ids grounded; overall status **human-attested** (a compliance officer signs off).
- **Quality Metrics Aggregation Layer** *(substrate)* — deterministic, read-only aggregation over captured signals (status/risk distributions, approval rate, reviewer-edit rate, median dwell, grounding-violation rate) per project; `GET /v1/metrics` + the `/insights` dashboard. Backed by `reviews.listByProject` / `audit.listByProject`.

*All four workflow designs went through an adversarial multi-agent design pass; the two the pass could not finish were authored in-house and adversarially self-reviewed (which caught + fixed the test-strategy prose-scraping over-block).*

## Wave 3 — CI reliability & operational learning *(shipped ✓)*

- **CI Failure Triage** — classifies a failure (product bug / flaky / infra / dependency / config / test bug / environment) with ranked root-cause hypotheses; failed-test names + evidence grounded in the log; never re-runs or changes CI.
- **Flaky Test Triage & Quarantine Advisor** — flakiness patterns from run history; **drafts** quarantine candidates only — a human applies them via a gated WriteGate (Arbiter never quarantines/writes).
- **Incident Postmortem Drafter** (Log/Trace Triage) — blameless timeline, root cause, typed action items (prevent/detect/mitigate/process), facts-vs-hypotheses; includes **incident-to-regression back-propagation** (the regression tests that would catch a recurrence).
- *Deferred substrate:* live read-only observability connectors (Datadog/Grafana/Sentry/Splunk) — same read-only pattern as the Jira connector; workflows accept pasted logs/history today.

## Wave 4 — API / data / non-functional authoring breadth

API Test Generator (+ Postman diff-plan) · Contract Drift / Version-Diff Impact Analyzer · Synthetic / PII-safe Test Data Generator (PII re-scan gate) · Security Abuse-Case Challenger · Accessibility AC & Manual-Script Generator · Performance Test-Plan Drafter · Non-Functional Result-to-Bug Triager.

## Wave 5 — Manual/exploratory depth & corpus reasoning (RAG-dependent)

Exploratory Charter Generator + session structuring · UAT Acceptance-Script Generator + sign-off · Cross-Requirement Inconsistency Checker (cite-two-sources guard) · Spec-Change Impact Analyzer · Locale-aware sanitizer recognizers *(component hardening)*.

## Wave 6 — Broadening authoring + tracked deferrals (later)

**Broadening authoring (medium ROI):** Smoke/Sanity Suite Designer · Persona-Driven Scenario Generator · Mobile Test-Case & Gesture-Flow Generator · Regression Impact Advisor · Mutation Survivor Explainer · Feature-Flag Test-Matrix + Stale-Flag Finder · DQ/DB-Assertion Drafter · Migration/ETL Test-Plan Generator · Resilience/Chaos GameDay Plan · DR/Backup-Restore Drill Checklist · SRE Runbook Drafter · Gated Ops-Config Drafter · Test Estimation Assistant · Executive Quality-Report Drafter.

### Deferred — hardening, infra & capability debt (tracked, not dropped)

Everything consciously deferred during Waves 0–1, with why it's safe today and when it's needed. None weaken the invariants; each is a known, bounded follow-up.

| Item | Status today | Pull in when |
|---|---|---|
| **De-mask store tenant-scoping** (project-scoped `resolve`) + **Postgres-backed, row-authorized de-mask store** | safe — `resolve` is unused in the prod path; store is process-local, AES-GCM in RAM | before any de-mask rehydration / real multi-tenant (with WriteGate re-hydration) |
| **Real OTLP → Langfuse exporter** | in-memory, OTel-shaped tracer behind `createTracer()` | when observability / Langfuse is stood up |
| **Server-side Presidio custom recognizers** | app-side custom recognizers cover member IDs/secrets/internal URLs in both engines | when centralizing PHI-coverage tuning |
| **Locale-aware sanitizer recognizers** (also Wave 5 #26) | English/US-format PII patterns only | before non-English member data flows |
| **Kimi read-failure distinct logging** | body-read failure swallowed to `''` | minor observability polish |
| **Container image size optimization** | builds & runs; CI-verified, not size-tuned | pre-deploy |
| **pgvector migration** for dense retrieval | Postgres FTS + app-side cosine over `real[]` behind the retrieval interface | at scale (drop-in behind the interface) |
| **Streaming on the LLM path** | non-streaming (spinner); Kimi thinking is slow | UX polish (biggest win while thinking is on) |
| **LiteLLM gateway + 2nd LLM provider** (judge independence) | Anthropic / Kimi / stub only | Eval Workbench judge calibration |
| **Expand eval suite → 20–30 cases/workflow** | ~20 code-based checks across 6 cases (CI gate seed) | ongoing, per workflow |
| **Frontend a11y + design pass** (`ecc:a11y-architect` + Lighthouse) | functional, not a11y-audited | a UI-polish milestone |
| **Full LLM Eval Workbench** (judge calibration, Ragas, statistical gating, garak/PyRIT) | not built (was the original Phase 4) | its own track after Waves 3–4 (billable client-facing service) |
| **Gated Defect Write-Back → Jira** (Wave 1 #3) | deferred by the read-only-Jira constraint | **only** against a sandbox Jira / GitHub / TestRail, with explicit per-target authorization — never the connected workspace |

## Delegated permanently (never built)

Test *execution* (Playwright/k6/Appium), visual-AI diffing (Percy/Chromatic), self-healing locators, predictive test-selection ML, fine-tuned models, browser-agent regression gates, GraphRAG, code embeddings, homegrown prompt/eval engines, consumer-driven-contract broker, quality-trend forecasting. See gap analysis §4.

---

**Logic:** Wave 1 buys immediate credibility by extending shipped workflows (no new substrate needed); Waves 2–3 are the actual QA→QE transformation and carry the strongest market differentiation (grounded + gated + audited versions of strategy, traceability, compliance, CI/operational learning don't exist elsewhere); Waves 4–5 broaden coverage once the connector + RAG substrate lands. Full rationale and per-item pipeline mappings: `docs/QA-GAP-ANALYSIS.md` (§3, §8).
