# Arbiter Roadmap — Quality Engineering Workbench

> Re-planned around the QA→QE gap analysis (`docs/QA-GAP-ANALYSIS.md`). This replaces the original Phase 0–5 numbering with a value-ordered **Wave** roadmap. Framing: Arbiter is a **governed Quality Engineering workbench** — it *drafts, grounds, validates, and gates* QA/QE artifacts and reads *back* from execution/observability tools; it never runs suites, never releases, and never writes without a gate.

**Non-negotiable invariants (hold at every wave):** AI drafts · humans approve · every output grounded · every action auditable · every write gated · read-only default. **Arbiter never writes to the connected Jira workspace** (enforced in code — all Jira calls are read-only; any write method throws before a request is sent).

---

## Wave 0 — Shipped (the governed workbench)

The spine and MVP are built, hardened, and on `main`:

- Guardrail pipeline `sanitize → ground → generate → validate → gate` (offline-first, pluggable to Postgres/RLS, Presidio, Anthropic/Kimi).
- **5 workflows:** Requirement & Ambiguity Analyzer, Test Case Generator (+Gherkin), Edge-Case Challenger, Bug Report Drafter, Release Readiness Summarizer.
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

## Wave 1 — Quick wins that extend shipped surface *(next)*

| # | Item | Effort | Notes |
|---|---|---|---|
| 1 | **Operational-Readiness gate** (Release Readiness v2) | S | SLOs/runbook/alerts/rollback/on-call in the Go/No-Go; human-owned |
| 2 | **NFR Completeness Analyzer** (extend Requirement Analyzer) | S | flags missing perf/security/a11y/i18n/resilience ACs — catches the non-functional domain at the cheapest point |
| 3 | **Grounded Release-Readiness inputs** | M | ground the Go/No-Go in real defect counts / test-run / eval results |
| — | ~~Gated Defect Write-Back → Jira~~ | — | **Deferred** — conflicts with "never write to the connected Jira." Will target a sandbox Jira only, with explicit per-target authorization. |

## Wave 2 — Core QE differentiators (the QA→QE leap)

Test Strategy Generator · Test Plan Generator (traces to strategy) · Requirements Traceability & Coverage Matrix (id-aware validator) · Compliance Control-Mapping & Evidence Pack (healthcare/PHI differentiator) · Quality Metrics Aggregation Layer *(substrate)*.

## Wave 3 — CI reliability & operational learning

CI Failure Triage / Root-Cause Drafter · Flaky Test Triage & Quarantine Advisor (quarantine only via WriteGate) · Log/Trace Triage + Incident Postmortem Drafter · read-only observability connectors *(substrate)* · Incident-to-Regression back-propagation.

## Wave 4 — API / data / non-functional authoring breadth

API Test Generator (+ Postman diff-plan) · Contract Drift / Version-Diff Impact Analyzer · Synthetic / PII-safe Test Data Generator (PII re-scan gate) · Security Abuse-Case Challenger · Accessibility AC & Manual-Script Generator · Performance Test-Plan Drafter · Non-Functional Result-to-Bug Triager.

## Wave 5 — Manual/exploratory depth & corpus reasoning (RAG-dependent)

Exploratory Charter Generator + session structuring · UAT Acceptance-Script Generator + sign-off · Cross-Requirement Inconsistency Checker (cite-two-sources guard) · Spec-Change Impact Analyzer · Locale-aware sanitizer recognizers *(component hardening)*.

## Wave 6 — Broadening authoring (medium ROI, later)

Smoke/Sanity Suite Designer · Persona-Driven Scenario Generator · Mobile Test-Case & Gesture-Flow Generator · Regression Impact Advisor · Mutation Survivor Explainer · Feature-Flag Test-Matrix + Stale-Flag Finder · DQ/DB-Assertion Drafter · Migration/ETL Test-Plan Generator · Resilience/Chaos GameDay Plan · DR/Backup-Restore Drill Checklist · SRE Runbook Drafter · Gated Ops-Config Drafter · Test Estimation Assistant · Executive Quality-Report Drafter.

## Delegated permanently (never built)

Test *execution* (Playwright/k6/Appium), visual-AI diffing (Percy/Chromatic), self-healing locators, predictive test-selection ML, fine-tuned models, browser-agent regression gates, GraphRAG, code embeddings, homegrown prompt/eval engines, consumer-driven-contract broker, quality-trend forecasting. See gap analysis §4.

---

**Logic:** Wave 1 buys immediate credibility by extending shipped workflows (no new substrate needed); Waves 2–3 are the actual QA→QE transformation and carry the strongest market differentiation (grounded + gated + audited versions of strategy, traceability, compliance, CI/operational learning don't exist elsewhere); Waves 4–5 broaden coverage once the connector + RAG substrate lands. Full rationale and per-item pipeline mappings: `docs/QA-GAP-ANALYSIS.md` (§3, §8).
