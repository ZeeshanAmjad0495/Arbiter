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

- **Per-project knowledge + retrieval (RAG)** *(shipped ✓):* project-scoped knowledge store (documents + chunks, RLS-protected, migration `0004`), a deterministic chunker, and TF-IDF lexical retrieval behind a stable `retrieveKnowledge` seam (Postgres FTS index in place; pgvector-swappable). Wired to the ground stage via `useKnowledge` — retrieved chunks become context-pack items, so generation is project-aware without re-pasting and cited facts still must appear in a retrieved chunk to ground. Knowledge is **sanitized before storage** (never a PHI sink). API: `GET/POST/DELETE /v1/knowledge`; UI: the Knowledge page + a workbench "Use project knowledge" toggle. Proven end-to-end in `tests/knowledge.test.ts` (ranking, per-project isolation, and RAG-feeds-grounding).
- **Read-only ground-source connectors:** Jira sync (read-only) ✓ · Confluence · observability (Datadog/Grafana/Sentry/Splunk) — ACL-mirrored, PII-sanitized. **Unblocks** Wave 3.
- **Quality Metrics Aggregation Layer:** deterministic aggregation over spans/edit-diffs/dwell/eval results → the real "quality trend line." **Unblocks** reporting/forecasting.
- **WriteGate** *(primitive shipped ✓):* `plan → named approval → apply → verify → append-only audit`. Read-only default; the only path Arbiter ever writes. Refuses to apply without a named human approval, and **HARD-refuses the connected Jira workspace at both register and apply time** (non-negotiable). Ships with an in-memory `SandboxWriteTarget`; real targets (GitHub / TestRail / Xray / sandbox Jira) implement the `WriteTarget` interface next. Proven in `tests/writegate.test.ts`.
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

## Wave 4 — API / data / non-functional authoring breadth *(partially shipped)*

**Shipped ✓:**
- **API Test Generator** — grounded API suite (happy/negative/boundary/auth/contract) with status codes + response assertions; endpoint, paths, and referenced fields grounded.
- **Contract Drift Analyzer** — diffs two contract versions into breaking vs non-breaking changes with consumer impact + migration actions; changed paths grounded.
- **Security Abuse-Case Challenger** — defensive abuse-case taxonomy (authz/injection/IDOR/replay/rate-limit/business-logic) with impact × likelihood + a test idea each.

**Shipped ✓ (with the gate it needed):**
- **Synthetic / PII-safe Test Data Generator** — now shipped **with the output PII re-scan gate**: `rescanOutput` re-scans the generated artifact and blocks export if any real PII *value* (email/SSN/card/phone/secret) leaks. Label-prone recognizers (MEMBER_ID/INTERNAL_URL) are excluded from the block set so a legitimate `member_email` column never false-blocks — and the MEMBER_ID recognizer was tightened to require a digit so column names aren't redacted from grounding context. Proven in `tests/rescan.test.ts`.

**Now shipped ✓:** Accessibility AC & Manual-Script Generator (WCAG 2.2) · Performance Test-Plan Drafter · Non-Functional Result-to-Bug Triager.

## Wave 5 — Manual/exploratory depth & corpus reasoning *(shipped ✓)*

Shipped as paste-in-context workflows (RAG will later auto-populate the corpus instead of manual paste — same schemas):

- **Exploratory Charter Generator** — session-based charter (mission, areas, tour-tagged test ideas, oracles/risks, timebox); guides exploration rather than scripting it.
- **UAT Acceptance-Script Generator** — business-readable scripts (persona, plain steps, expected outcome) traced to grounded requirement ids; sign-off human-owned.
- **Cross-Requirement Inconsistency Checker** — conflicts between requirements; **cite-two-sources** guard enforced by grounding (each inconsistency's two requirement ids must both exist in context).
- **Spec-Change Impact Analyzer** — old→new change → impacted requirement/test/endpoint ids (breaking/behavioral/additive) with actions; impacted ids grounded.
- *Deferred:* Locale-aware sanitizer recognizers (component hardening) — see the deferred table.

## Wave 6 — Broadening authoring + tracked deferrals *(core shipped ✓)*

**Shipped ✓ (curated high-value subset):** Smoke/Sanity Suite Designer · Regression Impact Advisor (grounded re-run vs skip) · Data-Quality / DB-Assertion Drafter · Migration/ETL Test-Plan Generator (mandatory reconciliation + rollback) · Executive Quality-Report Drafter (pairs with the Metrics layer).

**Full authoring tail — now shipped ✓:** Persona-Driven Scenario Generator · Mobile Test-Case & Gesture-Flow Generator · Mutation Survivor Explainer · Feature-Flag Test-Matrix + Stale-Flag Finder · Resilience/Chaos GameDay Plan · DR/Backup-Restore Drill Checklist · SRE Runbook Drafter · Gated Ops-Config Drafter (applied only via WriteGate) · Test Estimation Assistant.

### Deferred — hardening, infra & capability debt (tracked, not dropped)

Everything consciously deferred during Waves 0–1, with why it's safe today and when it's needed. None weaken the invariants; each is a known, bounded follow-up.

| Item | Status today | Pull in when |
|---|---|---|
| ~~**De-mask store — Postgres-backed, row-authorized**~~ ✅ shipped | Durable AES-256-GCM vault in Postgres (`0008`, RLS FORCE, ciphertext-only — the DB never sees plaintext); atomic per-(project,type) placeholder allocation; `projectId` threaded through `sanitize()`/`sanitizeCore()`/`sanitizeJson()`; admin-gated `POST /v1/demask/resolve` re-identification (audited by count) + `POST /v1/demask/purge` retention. `tests/demask.test.ts` covers memory, durable, tenant-isolation, and the endpoint | — (uncomment `ARBITER_DEMASK_KEY` to activate durability) |
| ~~**Real OTLP → Langfuse exporter**~~ ✅ shipped | `OtlpHttpExporter` + pure `toOtlpTraces` converter; the API flushes per-request spans to `OTEL_EXPORTER_OTLP_ENDPOINT` (→ Collector → Langfuse), best-effort, never blocks a request (`tests/otlp.test.ts`) | point it at a live collector |
| ~~**Server-side Presidio custom recognizers**~~ ✅ shipped | `toPresidioRecognizers()` emits Arbiter's custom recognizers in Presidio's pattern-recognizer config shape (JS flags → Python inline flags), so the SAME recognizers load into a Presidio analyzer server for centralized tuning (`tests/presidio-config.test.ts`) | serialize + mount in the analyzer's registry at deploy |
| ~~**Locale-aware sanitizer recognizers**~~ ✅ shipped | IBAN, E.164 international phone, UK NINO — anchored + validated, live in both engine paths (`tests/locale-sanitize.test.ts`) | — (extend with more locales on demand) |
| ~~**Kimi read-failure distinct logging**~~ ✅ shipped | a failed error-body read now logs `kimi_error_body_read_failed` and surfaces `<body read failed>` instead of silently becoming `''` | — |
| ~~**Container image size optimization**~~ ✅ shipped | added `.dockerignore` (keeps `node_modules`/`.git`/**`.env`** out of the build context + image); already multi-stage with `pnpm deploy --prod` on `node:22-slim`, non-root | fine-tune base at deploy time if needed |
| **pgvector / dense retrieval** — seam in place; activates with an embeddings provider | lexical TF-IDF retrieval ships behind the stable `retrieveKnowledge` seam; the `0004` migration already adds a Postgres FTS gin index. Dense/pgvector needs an external embeddings model, so it's a drop-in behind the interface — not a gap in the current offline path | when an embeddings provider is wired |
| ~~**Streaming — SSE run endpoint + workbench wiring**~~ ✅ shipped | `POST /v1/workflows/:id/run/stream` (Fastify `reply.hijack`) emits `open`/`stage`/`reasoning`/`done` SSE; the workbench shows a live stage stepper + reasoning panel via `runWorkflowStream`. Provider `generateStream` + `streamGenerate` fallback underneath (`tests/streaming.test.ts`) | — |
| ~~**LiteLLM gateway + 2nd LLM provider**~~ ✅ shipped | `OpenAICompatProvider` (LiteLLM / any OpenAI-compatible endpoint); precedence Kimi > Anthropic > LiteLLM > stub; `createJudgeProvider` picks an independent provider for the judge | point at a running LiteLLM gateway |
| **Expand eval suite → 20–30 cases/workflow** | ~20 code-based checks across 6 cases (CI gate seed) | ongoing, per workflow |
| ~~**Frontend a11y — Lighthouse/axe audit**~~ ✅ shipped | Full Lighthouse run (desktop) across login + every authenticated page: **100 accessibility / best-practices / SEO** everywhere. Fixed a missing meta-description, added a `<main>` landmark to the login screen, removed a pre-auth console 401, and corrected an active-tab contrast ratio | — (re-run per UI change) |
| **LLM Eval Workbench** — judge core ✅ · red-team/RAG harness ✅ · live Python tools scaffolded | `judgeArtifact` (rubric-scored LLM-as-judge) + independent judge provider (`tests/judge.test.ts`). **Red-team harness** (`pnpm eval:redteam`) runs the garak/PyRIT/Ragas *methodology* natively against the guardrail pipeline (offline gate; caught a real Stripe-key gap). Live-tool adapters (`evals/redteam.config.yaml`, dataset exporter, garak REST config) let the real Python tools drive a running server | run the Python tools in a client engagement (needs `pip install ragas garak pyrit`) |
| **Gated Defect Write-Back → Jira** (Wave 1 #3) | deferred by the read-only-Jira constraint | **only** against a sandbox Jira / GitHub / TestRail, with explicit per-target authorization — never the connected workspace |

## Wave 7 — Deployment-grade platform hardening *(shipped ✓ this session)*

The governance spine got its production teeth — every item offline-first with a real ⇄ offline seam chosen by config, RLS-isolated, gated:

- **Auth** — email-delivered access keys (sha256-hashed, shown once) → opaque sessions with TTL expiry; constant-time compare; login screen in the shell; admin bootstrap stable across restarts.
- **Per-project schemas + Schema Validator** — saved JSON Schemas (RLS) + an ajv validator that reports errors by path without echoing PII.
- **Knowledge Graph + GraphRAG** — deterministic entity/co-occurrence graph (`0007`, RLS), seed+expand retrieval behind `useGraph`, circular-viz UI. *(Reclassified from "delegated" — built deterministically, no embeddings.)*
- **Streaming workbench (SSE)**, **durable Postgres de-mask vault**, **Playwright/k6 execution runner** (`0009`; runs authored tests, feeds Metrics — real k6 verified live), **red-team/RAG eval gate** (garak/PyRIT/Ragas methodology), **Lighthouse 100s** — see the deferred table above, all now ✅.

## Delegated permanently (never built)

Visual-AI diffing (Percy/Chromatic), self-healing locators, predictive test-selection ML, fine-tuned models, browser-agent regression gates, code embeddings, homegrown prompt/eval engines, consumer-driven-contract broker, quality-trend forecasting. See gap analysis §4.

*(Note: **test execution** via Playwright/k6 and **GraphRAG** were pulled OUT of this list and built — test execution as a governed run-and-read-back runner, GraphRAG deterministically — at the operator's request.)*

---

**Logic:** Wave 1 buys immediate credibility by extending shipped workflows (no new substrate needed); Waves 2–3 are the actual QA→QE transformation and carry the strongest market differentiation (grounded + gated + audited versions of strategy, traceability, compliance, CI/operational learning don't exist elsewhere); Waves 4–5 broaden coverage once the connector + RAG substrate lands. Full rationale and per-item pipeline mappings: `docs/QA-GAP-ANALYSIS.md` (§3, §8).
