# Arbiter Gap Analysis: From "QA Workbench" to "Quality Engineering Workbench"

## 0. Framing: The Positioning Shift

Arbiter was conceived as a **governed AI workbench for QA engineers** — "AI drafts, QA owns judgment," with every workflow forced through one pipeline: **sanitize → ground → generate → validate → gate**. That framing is correct but too narrow for the audience this analysis serves (Junior QA through Head of QA). A modern **Quality Engineering (QE)** organization owns far more than test-case authoring: it owns requirement quality, strategy, traceability, non-functional quality, data and API correctness, CI reliability, production incident learning, and the governance/metrics layer that makes quality auditable.

This document therefore evaluates Arbiter against the **complete responsibility surface of an enterprise QE org**, and adopts the framing that Arbiter is — or is becoming — a **Quality Engineering workbench**: the governed authoring-and-analysis layer that sits *upstream* of execution tools and *reads back* from them, never replacing human judgment, never releasing autonomously, never writing without a gate, and never emitting an ungrounded claim.

Crucially, the shift is **not** a mandate to build execution engines. Arbiter's identity is preserved precisely by *integrating rather than rebuilding*: it drafts strategies, plans, cases, data, contracts, abuse-cases, postmortems and evidence packs — and delegates running them to Playwright, k6, TestRail, Jira, Grafana, Datadog, and their peers. The "QE workbench" framing widens *what Arbiter reasons about*, not *what Arbiter executes*.

Legend used throughout: **Built** = shipped Phase 0/1. **Planned** = designed but unbuilt, Phase 2–5. **Missing** = neither built nor planned.

---

## 1. Coverage Matrix

Every responsibility from all seven domain analyses is merged below. Exactly one status column is checked per row. "Partially Covered" means either (a) authoring is built but execution/round-trip is planned/delegated, or (b) the capability is explicitly designed in Phase 2–5 but not shipped. Per the ground-truth rule, **anything neither built nor in planned scope is Missing** — an adjacent primitive existing (a sanitizer, a validator, an audit store, a planned RAG corpus) does *not* earn Partially credit for a named responsibility Arbiter neither builds nor plans.

### A. Planning, Strategy, Estimation, Governance

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| Requirement & Ambiguity Analysis | ✓ | | | Built (Phase 1): testability score, per-ambiguity risk, missing ACs, clarified ACs. Grounded, gated. Flagship shift-left. |
| Risk Analysis (project/cross-artifact) | | ✓ | | Per-artifact risk table + risk-tiered gate built; no corpus-level risk model or risk-based prioritization. Regression-impact risk planned (P4). |
| Test Planning (scope/entry-exit/env/schedule) | | | ✓ | No test-plan artifact anywhere. Workflows are artifact-level, not plan-level. |
| Test Strategy (approach/levels/automation split) | | | ✓ | Core QA-architect deliverable with zero coverage in built or planned scope. |
| Test Estimation (effort/coverage sizing) | | | ✓ | No sizing capability, built or planned. |
| Process/Audit Traceability | ✓ | | | Built: append-only audit links run→sources→prompt→model→approver; artifacts carry workflowRunId. |
| Requirements Traceability Matrix (req→test→defect→release) | | | ✓ | Classic RTM does not exist; WriteGate to Xray/TestRail (P3) would enable persisted links but matrix is unbuilt. |
| Cross-Requirement Inconsistency Detection | | | ✓ | Single-req ambiguity is built, but cross-corpus contradiction detection is neither built nor a specified workflow in plan; the planned P2 RAG corpus is adjacent substrate, not this capability. Missing. |
| Specification Evolution / Spec-Change Impact | | | ✓ | Staleness badges + sync connectors are planned substrate; spec diffing and change-impact analysis is an unspecified/unplanned workflow. Missing. |
| Compliance (framework mapping + evidence) | | | ✓ | Raw evidence substrate is built, but HIPAA/SOC2 control→evidence mapping and reporting is neither built nor planned. Missing. |
| Documentation (living test docs) | | | ✓ | Export + versioned Prompt Library are adjacent primitives; test-estate documentation management is neither built nor planned. Missing. |
| Knowledge Sharing | | ✓ | | Shared prompt templates + edit-diff capture built; team KB delegated to Confluence connector (planned P2). |
| Coverage Analysis (requirement coverage metric) | | | ✓ | Taxonomy buckets + free-text notes are adjacent; quantitative requirement-coverage/gap analysis is neither built nor planned. Missing. |
| Quality Metrics & Governance Reporting | | ✓ | | Signals captured (spans, edit-diff, dwell, eval graders) — built; computed metrics/dashboards absent, governance console planned (P5). |
| Test Data Planning | | | ✓ | Sanitizer redacts inbound only; no synthetic/test-data planning, built or planned. |

### B. Test Design, Manual, Exploratory, Functional

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| Test Case Design | ✓ | | | Built: house-schema cases + Gherkin; Edge-Case Challenger 12-heuristic taxonomy. Arbiter's strongest area. |
| Exploratory Testing (charters/tours) | | | ✓ | No charter generation or session support. Edge-Case Challenger is adjacent, not exploratory. |
| Session-Based Testing (SBTM) | | | ✓ | No charter/session sheet/debrief/SBTM metrics anywhere in scope. |
| Manual Testing | | ✓ | | Authoring built; run execution/pass-fail/assignment delegated to TestRail/Xray via WriteGate (planned). |
| Regression Testing | | ✓ | | Regression Impact selection planned (P2–5); predictive ML deferred. No suite designation today. |
| Smoke Testing | | | ✓ | No smoke-set designation/generation, built or planned. |
| Sanity Testing | | | ✓ | No post-change sanity-set generation, built or planned. |
| UAT Support (acceptance scripts, sign-off) | | | ✓ | ACs + Go/No-Go adjacent; no UAT scripts/plan/sign-off package as a distinct capability. |
| Persona-based Testing | | | ✓ | No persona modeling/library/scenario generation anywhere. |
| Usability Testing | | | ✓ | Out of domain (human-observational); delegate execution. At most checklist authoring. |
| Test-Design Heuristics | ✓ | | | Built via Edge-Case Challenger's 12-heuristic taxonomy. |
| Usability/UX Heuristic Evaluation (Nielsen/WCAG) | | | ✓ | Distinct sense of "heuristic"; not covered — checklist authoring only would fit, but nothing built or planned. Missing. |
| Test Data Design (boundary/equivalence fixtures) | | | ✓ | No synthetic/edge dataset generation; buildable, must be schema-grounded. |
| Risk-based Test Prioritization | | ✓ | | Release risk table + low-value bucket give partial signal; no case-level risk scoring. |

### C. Automation, Quality Engineering, CI/CD, Reliability

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| Automation Framework Development | | ✓ | | Playwright codegen + API/Postman generators planned (P2–5); today only human-readable specs/Gherkin. |
| Test Maintenance | | ✓ | | Heal audit log + feedback flywheel planned; locator repair deferred to Playwright. No shipped suite maintenance. |
| Test Flakiness Detection / Quarantine | | | ✓ | Not built or planned. Single largest Test-Reliability gap. |
| Test-Suite Reliability (deflake/rerun/RCA) | | | ✓ | Eval gate reliabilizes Arbiter's *own* output, not the customer's suite. Do not overcredit. |
| CI/CD (own pipeline) | | ✓ | | Built: eval graders run every workflow in CI. Orchestrating customer pipeline out of scope (delegated). |
| Mutation Testing (interpret reports) | | | ✓ | No Stryker/PIT/mutmut ingestion; strong interpret-only ADD candidate. |
| Contract Testing (schema-aware) | | ✓ | | OpenAPI grounding + validator built; Source-vs-Output Validator + API Test Gen planned (P2–5). |
| Consumer-Driven Contracts (Pact) | | | ✓ | No Pact generation/broker/consumer modeling. |
| Feature Flag Validation | | | ✓ | No flag ingestion/matrix/stale-flag detection anywhere. |
| Test Data Management (fixtures/provisioning) | | | ✓ | Sanitizer protects inbound PII (adjacent primitive only); synthetic generation/provisioning is neither built nor planned. Missing — consistent with Test Data Planning (A) and Test Data Management (synthetic/fixtures) (D). |
| Regression Impact / Test Selection | | ✓ | | Planned (P2–5); predictive ML deferred. Advisory selection would fit. |
| CI Failure Triage / Root-Cause | | | ✓ | No CI-log ingestion/classification. High-value ADD. |
| Test Observability / Analytics Dashboards | | | ✓ | Correctly delegated to Grafana/Datadog/Allure/ReportPortal; consume as grounding, do not rebuild. |

### D. API, Database, Data

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| API Testing (functional execution) | | ✓ | | API Test Gen + Postman diff-plans planned (P4). Today OpenAPI is grounding only; no request execution. |
| API Contract Testing (Pact-style) | | | ✓ | Spec-awareness is an adjacent primitive; consumer/provider contracts + broker are neither built nor planned. Missing. |
| Schema-Drift Detection (version diff engine) | | ✓ | | Drift *heuristic* built; no OpenAPI v1-vs-v2 diff/impact engine. |
| Data Validation (output-vs-source) | | ✓ | | Grounding validator blocks invented fields (built); Source-vs-Output Validator deepens it (P2). Data-under-test validation missing. |
| Data Reconciliation (source-to-target) | | ✓ | | Doc-vs-JSON reconciliation planned (P2); table-to-table/row-count/checksum missing. |
| Test Data Management (synthetic/fixtures) | | | ✓ | No generation/provisioning/subsetting/masked-copy. Sanitizer is a building block only. |
| Database Testing (constraints/RLS/triggers) | | | ✓ | Arbiter's own RLS is product infra, not a user-facing DB-test capability. |
| ETL / Pipeline Validation | | | ✓ | No transformation/reconciliation/CDC/idempotency checks. |
| Data Quality (profiling/DQ rules) | | | ✓ | No Great Expectations/Soda/dbt-test generation. |
| Migration Testing | | | ✓ | No pre/post reconciliation, rollback, backfill, dual-write parity. |
| API Performance / Load Testing | | | ✓ | Correctly out of execution scope (k6/Gatling/JMeter). Could draft a plan; not built. |
| API Security Testing (authz/BOLA/injection) | | | ✓ | LLM red-team planned (P5) targets LLM features, not general appsec. Abuse-case authoring would fit. |

### E. Non-Functional Quality

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| Performance Testing | | | ✓ | OpenAPI grounding is an adjacent primitive only; no workload/think-time/SLA modeling or execution, built or planned. Missing. |
| Security Testing (appsec activity) | | ✓ | | Platform hardening built (not a QA capability); LLM red-team planned (P5); SAST/DAST/abuse-case authoring absent. |
| Accessibility (WCAG) | | | ✓ | No a11y workflow/grounding source/axe integration. Own UI a11y unverified. |
| Compatibility Testing (config matrix) | | | ✓ | No OS/runtime/version matrix concept. |
| Browser Compatibility | | | ✓ | Playwright codegen (P4) authors one script, not a cross-browser matrix. |
| Device Matrix Management | | | ✓ | No device/viewport matrix; correctly device-cloud territory. |
| Mobile Testing (native/hybrid apps, gestures, mobile flows) | | | ✓ | No native/hybrid mobile-app test authoring, gesture/mobile-flow coverage, or mobile-specific case generation, built or planned. Distinct from the (also-absent) device-matrix and browser-compat rows. Missing. |
| Localization Testing (i18n/l10n) | | | ✓ | No locale matrix/pseudo-loc. Note: sanitizer is likely English/US-PII biased — a real leak risk. |
| Chaos Testing | | | ✓ | No fault-injection; even experiment-plan authoring absent (good pipeline fit). |
| Resilience Testing | | | ✓ | Own offline-first fallbacks are product resilience, not a QA capability. |
| Reliability / Soak / Endurance | | | ✓ | No soak/MTBF/error-budget scenario generation. |
| Backup/Restore Validation | | | ✓ | No backup/restore test-plan for a system under test. |
| Disaster Recovery Testing | | | ✓ | No DR runbook/RTO-RPO plan/failover-drill sign-off. |
| NFR Completeness Analysis | | | ✓ | Requirement Analyzer is the natural host but is functional-AC-centric; NFR-gap flagging is neither built nor planned (recommended P0 extension). Missing. |
| Non-Functional Result Triage (scan→bug) | | | ✓ | Bug Report Drafter is an adjacent sink, but no scan-artifact grounding source exists and the workflow is neither built nor planned. Missing. |
| SLO/SLA & Error-Budget Definition | | | ✓ | No SLI/SLO/error-budget modeling. |

### F. Operational QA, SRE, Observability, Production

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| Production Validation (post-deploy smoke/canary) | | | ✓ | Arbiter is strictly shift-left/pre-release; nothing validates a running build. |
| Monitoring (metrics/alerting/dashboards) | | | ✓ | Out of scope by design; delegate to Datadog/Grafana/Prometheus. |
| Log Analysis (triage/clustering/RCA) | | | ✓ | No log ingestion/clustering. Strongest AI-drafting opportunity in the domain, unbuilt. |
| Observability (customer prod telemetry) | | | ✓ | OTel tracer is self-telemetry over Arbiter's *own* pipeline (product infra). Ingesting external/customer telemetry is neither built nor planned (planned connectors are Jira/Confluence RAG only, not observability backends). Missing. |
| Synthetic Monitoring (scheduled canaries) | | | ✓ | No probe authoring/scheduling. Could author + gate specs (delegate execution to Checkly/Datadog). |
| Environment Validation (config drift/parity) | | | ✓ | No env/config comparison or infra-health checks. |
| Production Incident Analysis (RCA/postmortem) | | | ✓ | Bug Report Drafter's facts-vs-hypotheses pattern is an adjacent scaffold only; telemetry-grounded RCA is neither built nor planned. Missing. |
| SLO / Error-Budget Management | | | ✓ | No SLO tracking/burn-rate. Delegate; Arbiter could draft SLO defs as gated diff-plans. |
| On-Call / Alerting Workflow | | | ✓ | No paging/escalation. Delegate to PagerDuty/Opsgenie/incident.io. |
| Runbook / Operational Documentation | | | ✓ | No runbook generation; natural pipeline fit, unbuilt. |

### G. Defects, RCA, Release, Metrics, Reporting, Prediction

| QA Responsibility | Covered | Partially | Missing | Comments |
|---|:---:|:---:|:---:|---|
| Defect Management (drafting) | | ✓ | | Bug Report Drafter built; gated write-back to Jira planned (P3). Lifecycle/DB delegated. |
| Root Cause Analysis (structured) | | | ✓ | No 5-whys/fishbone/causal-chain artifact or defect-to-commit correlation. |
| Release Readiness | ✓ | | | Built: risk table + human-owned Go / Go-with-risk / No-Go. Inputs are pasted text, not grounded metrics. |
| Metrics (computation layer) | | ✓ | | Signals captured; no aggregation (escape rate, defect density, review-edit rate, testability trend). The advertised "quality trend line" is unbuilt. |
| Reporting | | ✓ | | Per-artifact export + audit-trail export built; no program rollups/executive narrative/dashboards. |
| Defect Clustering / Dedup | | | ✓ | Not built or planned; P2 hybrid retrieval could enable it later. |
| Release Risk Prediction (quantitative/ML) | | | ✓ | Qualitative LLM risk table built; predictive ML deferred/delegated. |
| Quality Trend Forecasting | | | ✓ | No metrics time series to forecast on; ML forecasting out of scope. |
| Defect Triage (priority/dedup/routing) | | ✓ | | Severity reasoning built; priority normalization, draft-time dedup, routing missing. |
| Traceability (req→AC→test→defect) | | | ✓ | Every node produced but never linked into a matrix. High-value audit gap. |
| Defect Escape / Leakage Analysis | | | ✓ | No correlation of prod incidents vs pre-release coverage. |
| Audit Trail & Compliance Evidence | ✓ | | | Built and a genuine strength: who prompted, which sources, prompt/model version, approver; RLS + OTel traces; exportable. |

**Totals:** 6 Covered · 21 Partially Covered · 65 Missing (across 92 merged responsibilities). The strict ground-truth rule drives the high Missing count: capabilities resting only on an adjacent primitive — not built and not planned — are scored **Missing**, not Partially.

**Reconciliation of "6 Covered" against shipped surface:** the 6 Covered counts only responsibilities Arbiter owns *end-to-end within its authoring-and-analysis remit*. This does **not** contradict the fact that Phase 0/1 shipped five pipeline workflows (Requirement Analyzer, Test Case Generator, Edge-Case Challenger, Bug Report Drafter, Release Readiness) plus supporting systems (Review Queue, Export, versioned Prompt Library, Eval gate, append-only audit). Those authoring workflows score as *Partially* wherever execution or round-trip is delegated/planned — a deliberate authoring-vs-execution split, not under-crediting of built scope. Net: Arbiter is deep and defensible in requirement analysis, test-case design, release-readiness framing, and auditability — and thin-to-absent across non-functional, data/API execution-adjacent authoring, operational/production learning, and the metrics/traceability governance layer.

---

## 2. Missing Capabilities

Each entry: why it matters · who uses it · complexity · business value · priority. Ordered roughly by priority tier.

### P0 — Highest leverage, lowest effort, reuses shipped surface
- **NFR Completeness Analyzer (extend Requirement Analyzer).** Most non-functional defects trace to NFRs never written down; a shift-left lens that flags missing perf/security/a11y/i18n/resilience ACs catches the whole non-functional domain at the cheapest point. *Users:* QA, BAs, product owners. *Complexity:* low. *Value:* high. *Priority:* P0.
- **Operational-Readiness gates in Release Readiness.** Current Go/No-Go covers test/risk but not "SLOs defined? runbook exists? alerts wired? rollback plan? on-call assigned?". Extends a shipped workflow. *Users:* release managers, SRE, QA leads. *Complexity:* low. *Value:* high. *Priority:* P0.
- **Flaky Test Triage & Quarantine Advisor.** Flakiness is the top erosion of CI trust; without it teams ignore red or disable gating. *Users:* QA/SDET, release managers, on-call. *Complexity:* medium. *Value:* high. *Priority:* P0.
- **CI Failure Triage / Root-Cause Drafter.** Classifying a red build as product-bug vs flaky vs infra vs data is the daily QE grind; a facts-vs-hypotheses draft with a human-owned verdict saves hours per build. *Users:* on-call QA, SDET, dev triager. *Complexity:* medium. *Value:* high. *Priority:* P0.

### P1 — Core responsibilities, strong pipeline fit
- **Test Strategy Generator.** Core QA-architect deliverable with zero coverage; today done in ad-hoc chat — exactly what Arbiter replaces. *Users:* QA leads/architects. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Test Plan Generator.** No scope/entry-exit/env/schedule artifact; needed for release governance and audit. Links to its parent strategy. *Users:* QA leads, release managers. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Requirements Traceability & Coverage Matrix (req→AC→test→defect→release).** Every node exists but is never linked; the artifact auditors and leads ask for. *Users:* QA leads, compliance, product. *Complexity:* medium–high. *Value:* high. *Priority:* P1.
- **Spec-Change / Schema Version-Diff & Impact Analyzer.** When a spec/schema/ticket changes, nothing says which tests are now stale; classify breaking vs non-breaking and map to affected artifacts. *Users:* API QA, platform teams, QA leads. *Complexity:* medium–high. *Value:* high. *Priority:* P1.
- **Cross-Requirement Inconsistency Checker.** Contradictions across a requirement set go undetected; depends on the P2 RAG corpus, and the workflow itself is currently unspecified (hence Missing, not Partial, in the matrix). *Users:* QA engineers, BAs. *Complexity:* high. *Value:* high. *Priority:* P1.
- **Compliance Control-Mapping & Evidence Pack Generator.** Arbiter produces excellent raw evidence but cannot map it to HIPAA/SOC2 controls or emit an auditor-ready pack; a direct healthcare/PHI differentiator. *Users:* compliance, QA leads, auditors. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **API Test Generator (functional + negative + Postman/Newman collection).** Promised in P4, currently unbuilt; the single most direct API-domain capability. *Users:* API QA, SDETs. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Synthetic / PII-safe Test Data Generator.** QA constantly needs schema-valid, constraint-satisfying, PII-free fixtures; Arbiter already owns the two hardest prerequisites (schema-grounding pack + sanitizer). *Users:* QA, SDETs, test-env owners. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Exploratory Test Charter Generator + session structuring.** Core manual-QA practice with zero support; QAs improvise charters in ChatGPT today. *Users:* manual/exploratory QA, SBTM leads. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **UAT Acceptance-Script Generator + sign-off package.** Turns grounded ACs into business-readable scripts and an auditable sign-off — compliance-relevant evidence Arbiter already excels at. *Users:* QA leads, BAs, product owners. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Performance Test-Plan & Workload Model Drafter.** Grounding on OpenAPI already knows endpoints; generate workload mix, think-times, thresholds as an exportable k6/JMeter plan without executing. *Users:* perf testers, QA, SREs. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Security Abuse-Case / Threat-Model Challenger.** Extends Edge-Case Challenger with OWASP Top-10/ASVS abuse cases grounded in the spec — fills the gap between platform hardening and security-test authoring. *Users:* QA, security-minded testers, appsec. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Accessibility AC & Manual-Script Generator.** WCAG 2.2 is a stable groundable rule set; generated ACs become mechanically validatable (validator confirms each cited success criterion). *Users:* QA, a11y specialists. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Non-Functional Result-to-Bug Triager.** Feed noisy k6/axe/ZAP/Lighthouse output (as grounding) into the Bug Report Drafter for Jira-ready, facts/hypotheses-separated bugs. *Users:* QA, SRE, security testers. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Telemetry-grounded Incident Postmortem Drafter.** Blameless postmortems under time pressure miss action items; facts-vs-hypotheses discipline + audit trail are ideal. *Users:* SRE, on-call, incident commanders. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Log / Trace Triage Summarizer.** Cluster errors, separate observed facts from hypotheses, with grounding that blocks invented stack traces. *Users:* SRE, support, QA repro. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Incident-to-Regression-Test back-propagation.** Production incidents should durably harden the suite; generate grounded regression cases from a resolved incident, feeding the flywheel. *Users:* QA, SRE. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Read-only Observability Ground-Source Connectors (Datadog/Grafana/Sentry/Splunk).** Prerequisite substrate for every production-domain workflow; ACL-mirroring, PII-sanitized, read-only. *Users:* all above, SRE, QA. *Complexity:* high. *Value:* high. *Priority:* P1. *Pipeline note:* this is ingestion/substrate that feeds the **ground** stage of other workflows — it is **not** itself a sanitize→ground→generate→validate→gate workflow, and is intentionally absent from the Section 3 pipeline-mapped list. Sequence it as enabling infrastructure.
- **RCA Assistant (causal-chain / 5-whys).** Highest-leverage recurrence-prevention activity; separates facts from ranked causal hypotheses, never asserting a single root cause. *Users:* QA/dev leads, SRE. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Quality Metrics Aggregation Layer.** Signals captured but never computed; without it the "quality trend line" and all reporting/forecasting are impossible. *Users:* QA managers, eng leadership. *Complexity:* medium. *Value:* high. *Priority:* P1. *Pipeline note:* this is **deterministic aggregation/computation** over already-captured signals (spans, edit-diffs, dwell, eval results) — no LLM structured generation, no grounding validator, no per-artifact human gate. It does **not** pass through the single pipeline and is intentionally absent from the Section 3 list. Treat it as enabling infrastructure, not a pipeline workflow; it remains identity-consistent (read-only, no ungated write).
- **Grounded Release-Readiness Inputs.** The Go/No-Go is only as good as its inputs, currently pasted text; ground it in real defect counts, blockers, test-run/eval results. *Users:* release managers, QA leads. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Gated Defect Write-Back (WriteGate → Jira).** Without round-trip, the Bug Drafter is copy-paste; gated create/update makes it a workflow. Already designed P3. *Users:* QA engineers filing defects. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Contract Drift / Breaking-Change Analyzer.** Old-vs-new OpenAPI diff + consumer impact ties directly to existing schema grounding + validator strengths. *Users:* API QA, platform, integration owners. *Complexity:* medium. *Value:* high. *Priority:* P1.
- **Regression Impact Advisor (advisory, non-gating).** Change→test mapping shrinks feedback loops; already planned — prioritize as explainable, grounded recommendation, not autonomous selector. *Users:* SDET, CI owners. *Complexity:* high. *Value:* high. *Priority:* P1.
- **Locale-aware Sanitizer Recognizers.** The sanitizer is sold as a hard guarantee; if it only catches English/US-format PII, non-English member data leaks to the model — a correctness gap in a shipped control. *Users:* all QA in multilingual contexts. *Complexity:* medium. *Value:* high. *Priority:* P1. *Pipeline note:* this is a **correctness fix to the sanitize component**, not a full-pipeline workflow — important, but scoped to hardening one stage rather than adding a generate→validate→gate feature; intentionally absent from the Section 3 list.

### P2 — Valuable, more effort or narrower audience
- **Test Estimation Assistant** (grounded, advisory draft; never an autonomous number). *Complexity:* medium. *Value:* medium.
- **Smoke/Sanity Suite Designer** (derive critical-path smoke + change-scoped sanity from the corpus + risk). *Complexity:* medium. *Value:* medium.
- **Persona Library + Persona-Driven Scenario Generator** (catches role/permission/workflow gaps). *Complexity:* medium. *Value:* medium.
- **Schema-grounded Test-Data Designer** (boundary/equivalence datasets, referentially-valid fixtures — anti-hallucination sweet spot). *Complexity:* high. *Value:* medium.
- **Mobile Test-Case & Gesture-Flow Generator** (native/hybrid app flows, gesture/interaction cases, mobile-specific ACs; grounded on app spec, execution delegated to Appium/device cloud). *Complexity:* medium. *Value:* medium.
- **Mutation Survivor Explainer** (interpret Stryker/PIT/mutmut; propose missing assertions). *Complexity:* medium. *Value:* medium.
- **Feature Flag Test-Matrix Generator + Stale-Flag Finder.** *Complexity:* medium. *Value:* medium.
- **Data Reconciliation / Source-to-Target Validator (datastore-level)** for ETL/migration. *Complexity:* high. *Value:* high.
- **Data Quality Rule Drafter (Great Expectations/dbt-test/Soda config).** *Complexity:* medium. *Value:* medium.
- **SQL / DB Assertion Drafter** (constraint/RI/RLS assertions; export, never execute). *Complexity:* medium. *Value:* medium.
- **Migration / ETL Test-Plan Generator** (reconciliation + rollback + backfill, human-owned go/no-go). *Complexity:* high. *Value:* high.
- **Resilience / Chaos GameDay Plan Drafter** (steady-state, blast radius, abort/rollback; execution delegated). *Complexity:* medium. *Value:* medium.
- **DR / Backup-Restore Drill Checklist & Sign-off** (RTO/RPO plan, human-owned sign-off). *Complexity:* medium. *Value:* medium.
- **Localization Test-Case & Pseudo-Localization Generator.** *Complexity:* medium. *Value:* medium.
- **Gated Ops-Config Drafter (synthetic checks / SLO / alert-rule YAML)** as WriteGate diff-plans. *Complexity:* medium. *Value:* medium.
- **SRE Runbook Drafter** (grounded in service docs + past incidents). *Complexity:* low. *Value:* medium.
- **Defect Clustering & Duplicate Advisor** (semantic clustering for human confirmation). *Complexity:* high. *Value:* medium.
- **Executive / Stakeholder Quality Report Drafter** (narrative over computed metrics; depends on metrics layer). *Complexity:* medium. *Value:* medium.
- **Defect Escape / Leakage Analysis.** *Complexity:* high. *Value:* medium.

### P3 — Lower ROI or better delegated
- **Usability/UX Heuristic-Evaluation Checklist Generator** (authoring only). *Complexity:* low. *Value:* low.
- **Compatibility / Device-Matrix Definition Helper** (rationale is auditable; execution delegated). *Complexity:* low. *Value:* medium.
- **Consumer-Driven Contract Assistant (Pact-aware)** (draft expectations; delegate broker). *Complexity:* high. *Value:* medium.
- **Quality Trend Forecasting** (needs stable metrics history first; better delegated). *Complexity:* high. *Value:* low.

---

## 3. Features Worth Building

Each fits Arbiter's identity, maps to **sanitize → ground → generate → validate → gate**, preserves human approval, and adds no ungated write surface. No generic chat features. The 18 features below are precisely the ones that map cleanly onto the *full* pipeline. Three separately-recommended items (Section 2) are deliberately **excluded** here because they are not pipeline workflows: the **Quality Metrics Aggregation Layer** (deterministic aggregation over captured signals), the **read-only observability ground-source connectors** (ingestion substrate feeding the *ground* stage), and the **locale-aware sanitizer recognizers** (a correctness fix to the *sanitize* component). Those are enabling infrastructure/component work — sequenced in Section 8, not full-pipeline features.

**1. Test Strategy Generator** — *sanitize* requirement/context inputs → *ground* on requirement corpus/schema/Jira context pack → *generate* Zod strategy (levels, types, automation split, risk focus, tooling) → *validate* every referenced feature/endpoint/risk is grounded → *gate* at high/medium risk tier with append-only audit. **Governance:** strategy is advisory; QA-lead approval mandatory before it becomes strategy-of-record. Fits the existing risk-tiered gate unchanged.

**2. Test Plan Generator** — *sanitize* → *ground* on the parent strategy artifact + release context → *generate* typed TestPlan schema (scope, entry/exit, environments, schedule, resourcing) → *validate* scope items against grounded requirements → *gate* (high tier) + trace to parent strategy `artifactId`. **Governance:** extends the audit/trace chain; no autonomous approval.

**3. Requirements Traceability & Coverage Matrix** — *sanitize* → *ground* on in-project requirements + generated cases + bug artifacts → *generate* link set + coverage-gap report → *validate* every linked id exists (id-aware upgrade of the SubstringGroundingValidator; no phantom coverage) → *gate* before any WriteGate push of links into Xray/TestRail. **Governance:** read-only matrix by default; writing links is a WriteGate diff-plan → named approval → apply → verify → audit.

**4. Spec-Change / Version-Diff Impact Analyzer** — *sanitize* both versions → *ground* on prior context pack + both specs + existing test inventory → *generate* impact set (changed fields/endpoints → affected artifacts, breaking vs non-breaking) → *validate* every cited path/field exists in one of the two grounded specs → *gate* medium/high, routing impacted artifacts to the Review Queue. **Governance:** builds on planned Source-vs-Output + staleness infra; never auto-invalidates artifacts.

**5. Cross-Requirement Inconsistency Checker** — *sanitize* → *ground* via hybrid RAG retrieval over the requirement corpus (P2) → *generate* contradiction pairs with citations → *validate* both sides cite real corpus chunks (blocks fabricated conflicts; unexportable otherwise) → *gate* for human confirmation. **Governance:** every flagged conflict must cite two grounded sources; human confirms before it becomes a tracked issue.

**6. Compliance Evidence Pack Generator** — *sanitize* → *ground* on the existing AuditEvent/ReviewLog store + a control catalog → *generate* control→evidence mapping → *validate* every evidence citation resolves to a real audit-event id → *gate* with QA-lead/compliance sign-off; the pack becomes an audited artifact. **Governance:** pure read + assemble over immutable audit data; strengthens auditability, adds no write surface.

**7. Exploratory Test Charter Generator + Session Structuring** — *sanitize* raw notes/feature text → *ground* on feature spec/Jira/schema → *generate* Zod charter set (mission, areas, risks, tours, time-box) + structured session sheet → *validate* charter areas/endpoints exist in grounding (block invented features) → *gate* QA approves charters + debrief; edit-diff/dwell feed the flywheel. **Governance:** execution stays human; charters are drafts.

**8. UAT Acceptance-Script Generator** — *sanitize* AC/story input → *ground* on requirement + AC source (reuse Requirement Analyzer output) → *generate* Given/When/Then UAT scripts + sign-off manifest → *validate* every referenced requirement/AC id exists (no invented ACs) → *gate* named business-owner approval; append-only sign-off as compliance evidence. **Governance:** sign-off explicitly human-owned; no autonomous acceptance.

**9. API Test Generator (functional + negative + Postman diff-plan)** — *sanitize* spec + example payloads (credential hard-block) → *ground* OpenAPI context pack → *generate* Zod test cases (happy/boundary/negative/authz) + Newman collection → *validate* reject any endpoint/param/field not in the spec (invented routes unexportable) → *gate* risk-tiered review; WriteGate diff-plan to push the collection. **Governance:** Arbiter never fires requests; the only write is a gated collection push.

**10. Synthetic / PII-safe Test Data Generator** — *sanitize* reject any seed containing real PII/creds → *ground* table/schema/OpenAPI drives field types + constraints → *generate* Zod-valid rows → *validate* schema + referential/constraint check **plus a PII re-scan** so no generated value matches a real identifier pattern (violations block export) → *gate* reviewer approves; export/WriteGate to fixtures; audit records schema + prompt/model version. **Governance:** small fixtures only, synthetic-only; production-scale synthesis delegated (Tonic/Gretel/Mostly AI).

**11. NFR Completeness Analyzer (extend Requirement Analyzer)** — *sanitize* requirement text → *ground* against project spec + versioned NFR checklist library (OWASP ASVS, WCAG 2.2, perf-SLA templates) → *generate* Zod list of NFR gaps + suggested ACs → *validate* each cited standard clause exists in the grounded checklist → *gate* risk-tiered review with audit of the checklist version used. **Governance:** pure drafting; reviewer owns every suggested AC.

**12. Security Abuse-Case Challenger** — *sanitize* → *ground* on spec + threat-heuristic library → *generate* structured abuse/negative security cases with a low-value bucket → *validate* referenced endpoints/params exist in the grounded context → *gate* human review + audit. **Governance:** authoring only; no scanning or exploitation.

**13. Accessibility AC & Manual-Script Generator** — *sanitize* → *ground* on WCAG success-criteria corpus + component inventory → *generate* a11y ACs + keyboard/screen-reader scripts tied to specific SC ids → *validate* every cited SC id exists in the grounded WCAG source → *gate* human review + audit. **Governance:** automated a11y execution stays in axe/Lighthouse.

**14. Performance Test-Plan Drafter** — *sanitize* any pasted traffic sample → *ground* on OpenAPI (endpoints, documented SLAs) → *generate* Zod workload artifact (mix, concurrency, think-times, ramp, thresholds) → *validate* reuse grounding validator to block invented endpoints → *gate* review then WriteGate diff-plan for k6/JMeter export. **Governance:** the anti-hallucination guarantee transfers directly; execution external.

**15. Flaky Test Triage & Quarantine Advisor** — *sanitize* strip repo/env ids + secrets from logs → *ground* run-history context pack (pass/fail sequences, timing, error signatures), user-visible → *generate* Zod flakiness verdict {testId, flakeScore, evidenceRefs, recommendation} → *validate* every cited failure/testId exists in ingested runs (no invented tests) → *gate* risk-tiered review; quarantine applied **only** via WriteGate. **Governance:** auto-quarantine forbidden; quarantine is a gated write with edit-diff capture.

**16. CI Failure Triage / Root-Cause Drafter** — *sanitize* scrub logs (credential hard-block) → *ground* failing job logs, diff, prior runs → *generate* {classification, confidence, facts[], hypotheses[], nextChecks[]} → *validate* block any log line/stack frame not in the ingested artifact → *gate* human confirms classification before any downstream write; hands off to the gated Bug Report Drafter. **Governance:** verdict advisory; no autonomous ticket creation.

**17. Incident Postmortem Drafter + Log/Trace Triage Summarizer** — *sanitize* heavy (prod logs are secret-dense; hard-block load-bearing) → *ground* fetched incident timeline + telemetry (read-only) → *generate* Zod postmortem (timeline, contributing factors, 5-whys, impact, actions) with facts vs hypotheses → *validate* block invented events/timestamps/services/stack frames not in source telemetry → *gate* mandatory human review + append-only audit. **Governance:** read-only ingest; any resulting bug/action goes through its own gate.

**18. Operational-Readiness Gate (Release Readiness v2)** — *sanitize* standard → *ground* project artifacts (runbook, alert configs, SLO defs) → *generate* Zod readiness table with per-item evidence pointers → *validate* block claiming an artifact exists when it was not in the context pack → *gate* human owns the Go/No-Go, append-only audit. **Governance:** smallest, highest-leverage change — extends a shipped workflow, preserves the human-owned decision.

---

## 4. Features That Should NOT Be Built

Delegated to keep Arbiter read-only-default, non-autonomous, and integrate-not-rebuild.

| Do not build | Delegate to | Why |
|---|---|---|
| Test execution / orchestration engine, HTTP/API runner, assertion engine | Playwright, pytest, JUnit, Jest, Newman, REST Assured, Karate | Running suites/firing requests is execution; Arbiter drafts and pushes via WriteGate, reads results back. |
| Requirements management system of record | Jira / Confluence / Azure DevOps | Rebuilding the repository duplicates the source of truth and breaks read-only-default. |
| Test-run management (runs, pass/fail, assignment, history) | TestRail / Xray / Zephyr (via WriteGate) | Mature, solved; expands the write surface Arbiter deliberately minimizes. |
| Project scheduling / capacity / Gantt | Jira Plans / Azure DevOps Boards | PM-system concern; Arbiter drafts test-effort inputs, not schedules. |
| Metrics/BI dashboards & analytics | Grafana / Datadog / Looker / Allure / ReportPortal | Arbiter already emits OTel spans; a thin governance console is the most that is warranted. |
| Load / performance / stress generation | k6 / Gatling / JMeter / Locust | Distributed traffic generation is infra; Arbiter authors the plan and exports. |
| Accessibility scanning engine | axe-core / Lighthouse / Pa11y | Deterministic DOM scanning is best-in-class already; Arbiter authors WCAG-grounded criteria and triages results. |
| SAST/DAST/dependency/pentest tooling | Snyk / Semgrep / OWASP ZAP / Burp / Dependabot | Specialized, continuously-updated engines; building them also risks weakening read-only stance. |
| Mutation testing engine | Stryker / PIT / mutmut | Compute-heavy, language-specific; Arbiter interprets the report only. |
| Mobile app execution / device automation | Appium / Espresso / XCUITest / BrowserStack App Live | Driving real native/hybrid apps on devices is execution; Arbiter authors mobile cases/gesture flows and reads results. |
| Contract broker / can-i-deploy gating | Pact Broker | Broker state + deployment gating is dedicated infra; Arbiter drafts contracts, reads status. |
| Feature-flag management platform | LaunchDarkly / Flagsmith / OpenFeature | Flag serving is a live production system; Arbiter stays read-only, never toggles. |
| DB/DQ/ETL execution runtime, data movement | dbt / tSQLt / Great Expectations / Soda / Deequ | Running assertions and moving datasets is execution against user infra; would require ungated data access. |
| Production-scale synthetic data / de-identification certification | Tonic.ai / Gretel / Mostly AI | Referential-integrity-preserving synthesis at volume is a platform problem; Arbiter drafts small fixtures. |
| Data observability / anomaly monitoring | Monte Carlo / Bigeye / Datadog | Continuous autonomous scoring is incompatible with the gated-draft model. |
| Metrics collection / alerting / paging / on-call | Datadog / Grafana / Prometheus / PagerDuty / Opsgenie / incident.io | Latency-critical stateful infra; Arbiter drafts the postmortem/comms after the page, gated. |
| Synthetic monitor execution & scheduling | Checkly / Datadog Synthetics / Grafana | Scheduled prod probes are a runner concern; running autonomously conflicts with no-autonomous-action. Author + gate the spec only. |
| Log aggregation / indexing / search; APM/tracing infra | Splunk / Elastic / Loki / Datadog APM / Honeycomb / Tempo | Data-platform scale; Arbiter reads a bounded, sanitized slice as grounding. |
| SLO tracking / error-budget computation | Nobl9 / Datadog SLO | Streaming SLI/burn-rate math is a platform capability; Arbiter drafts SLO defs (gated) only. |
| Chaos injection execution | Gremlin / Litmus / Chaos Mesh / AWS FIS | Injecting faults is a privileged, potentially destructive write — categorically against safety-over-convenience. Author the plan only. |
| Backup/restore & DR orchestration | Velero / AWS Backup / cloud-native DR | Snapshot/restore/failover is infra automation; Arbiter owns the drill checklist + auditable sign-off. |
| Cross-browser/device execution grid | BrowserStack / Sauce Labs / LambdaTest / Playwright | Running real browsers/devices at scale is infra; Arbiter generates/governs the matrix definition. |
| Visual-diff & self-healing locators | Percy / Chromatic / Playwright healer | Already deferred; rebuilding adds ungoverned autonomy with no strategic gain. |
| Predictive test-selection ML; estimation ML; fine-tuned/homegrown eval-prompt models | Launchable / specialist ML / human-owned estimation / provider models + code graders | Opaque models conflict with grounding/explainability/auditability and add infra Arbiter should not own. |
| Real-time anomaly detection / auto-remediation / self-healing prod actions | Datadog Watchdog / ops-platform self-healing | Autonomous action with no discrete human gate and no per-inference grounding — violates hard constraints. |

---

## 5. Future AI Opportunities (5-Year)

For each: does it belong inside Arbiter, and why.

**Belongs inside Arbiter** (grounded, gated, human-owned — extends the identity):
- **Cross-requirement inconsistency detection** — high-value QA reasoning; safe only because it must cite two grounded sources and be human-confirmed. Natural once the P2 RAG corpus lands.
- **Spec-change / schema-drift impact reasoning** — diff is deterministic; the LLM's value is grounded impact narration and test mapping, validated against both specs, routed to the Review Queue (never auto-invalidation).
- **Risk scoring / risk-based prioritization** — advisory draft feeding the human-owned gate and risk tiers; must never auto-decide priority.
- **Flaky-test root-cause and CI-failure classification** — facts-vs-hypotheses reasoning over run history/logs; quarantine remains a WriteGate diff-plan.
- **Telemetry-grounded postmortem / RCA and log-trace triage** — textbook fit: structured generation, grounding validator blocking invented events/frames, mandatory human review, append-only audit.
- **Incident-to-regression-test synthesis** — closes the prod-to-test loop, reuses the Test Case Generator schema, strengthens the flywheel with production signal.
- **LLM-as-judge artifact-quality scoring** — fits the planned Eval Workbench with calibrated judges and statistical gating; strengthens (not replaces) human review.
- **LLM security red-team (garak/PyRIT/OWASP LLM Top-10)** — already planned P5; a governed, billable service consistent with the platform.
- **Reviewer edit-diff mining → prompt/eval/exemplar improvement (feedback flywheel)** — closes the loop on AI-output reliability entirely inside the governance boundary.
- **Auto-generated traceability link *suggestions*** — generating links belongs inside; persisting them must go through WriteGate (named approval + audit).
- **Runbook / ops-config (SLO, alert, synthetic) drafting** — draft + gated WriteGate apply; Arbiter authors, human approves, external tool runs.
- **NL-to-SQL / DQ-rule / assertion drafting from a grounded schema/profile** — Zod-validated, checked against real columns, exported as config for an external engine.

**Does NOT belong inside Arbiter** (violates a hard constraint — grounding, gating, human-approval, no-autonomous-action, auditability):
- **Autonomous Go/No-Go release decisions** — no autonomous releases; Arbiter summarizes risk, the human decides (signOffRequired).
- **Autonomous test execution / triage / auto-close / auto-quarantine / self-healing apply** — ungated writes and suite mutation; must remain WriteGate diff-plans.
- **Autonomous chaos injection / self-healing production remediation** — destructive ungated action.
- **Real-time streaming metric anomaly detection / predictive perf-regression / alert-fatigue ML** — continuous ML with no discrete human-gated decision and no per-inference grounding pack; architecturally incompatible. Consume its outputs as grounding instead.
- **Autonomous data writes / auto-correcting bad records / live query optimization** — any write to user data must be a gated diff-plan; direct mutation breaks the constraints.
- **AI-driven visual/layout diffing over screenshots** — a perception model outside the grounded-text pipeline; already deferred to Percy/Chromatic.
- **Autonomous usability / task-success scoring** — requires real-user observation Arbiter cannot ground; an LLM "usability score" is ungrounded opinion. Checklist authoring only.
- **Predictive ML test-selection and fine-tuned/homegrown eval-prompt models** — opaque, unauditable; keep selection advisory and grounding-based, and use provider models + code graders.

The through-line: over five years Arbiter should deepen as the **governed reasoning and authoring brain** across the full QE surface — inference, drafting, and evidence assembly that are *grounded, explainable, gated, and audited* — while every form of execution, autonomy, and continuous streaming stays delegated.

---

## 6. QA Maturity Mapping

What each level can accomplish **entirely inside Arbiter** today (Built) and near-term (Planned/Recommended), versus what still **needs external tools**.

**Junior QA**
- *Inside Arbiter:* generate house-schema test cases + Gherkin, run the Requirement & Ambiguity Analyzer on a ticket, draft a Jira-ready bug (facts vs hypotheses), challenge a feature with the 12-heuristic edge-case taxonomy, export Markdown/CSV/JSON. All grounded and validated so they cannot ship invented endpoints/fields.
- *Needs external tools:* actually executing tests (Playwright/manual), filing the bug into Jira (until WriteGate P3), running any scan.

**Mid QA**
- *Inside Arbiter:* everything above + (recommended) exploratory charters + session structuring, UAT acceptance-script drafting, persona-driven scenarios, schema-grounded test-data drafts, NFR-gap flagging, mobile case/gesture-flow drafting, abuse-case and accessibility-AC authoring.
- *Needs external tools:* test-run management (TestRail/Xray), a11y/security/perf execution (axe, ZAP, k6), mobile device automation (Appium/device cloud), device grids (BrowserStack).

**Senior QA / SDET**
- *Inside Arbiter:* API test-case + Postman collection drafting, contract-drift/version-diff impact analysis, flaky-test triage + quarantine *recommendation*, CI-failure root-cause drafting, mutation-survivor explanations, synthetic PII-safe fixtures — all as gated diff-plans.
- *Needs external tools:* running Newman/Playwright/k6/Stryker, the CI system itself, the flag platform, the DB — Arbiter authors and interprets; the runner executes.

**Test Lead**
- *Inside Arbiter:* smoke/sanity suite designation, regression-impact *advisory* selection, grounded release-readiness with operational-readiness gates, incident-to-regression back-propagation, review-queue triage over reviewer edit-diffs.
- *Needs external tools:* execution orchestration, scheduling/assignment (Jira/TestRail), observability backends for the grounding it reads.

**Staff QE**
- *Inside Arbiter:* cross-requirement inconsistency checking (post-RAG), spec-change impact across the corpus, telemetry-grounded RCA/postmortems and log-trace triage, DQ/DB-assertion and migration/ETL test-plan drafting, LLM Eval Workbench (calibrated judges, Ragas, red-team) for clients' LLM features.
- *Needs external tools:* the observability/telemetry platforms, data engines (dbt/Soda/Deequ), chaos back-ends — Arbiter drafts plans and reads results.

**QA Architect**
- *Inside Arbiter:* Test Strategy and Test Plan generation, the Requirements Traceability & Coverage Matrix, tooling/automation-split strategy synthesis, governance over prompt versions and eval gates — the strategy-of-record and coverage governance layer, all human-approved.
- *Needs external tools:* the systems those strategies target (CI, test management, monitoring); Arbiter is the reasoning/authoring layer, not the execution estate.

**Head of QA**
- *Inside Arbiter:* the quality-metrics aggregation layer (escape rate, defect density, review-edit rate, testability/eval trend), executive quality-report drafting over those metrics, Compliance Control-Mapping & Evidence Pack generation, and the governance console for approval rates / hallucination-block rate / reviewer-override trend.
- *Needs external tools:* BI/observability stacks (Grafana/Datadog/Looker) where governance signals are visualized; incident/on-call platforms. Arbiter supplies the governed evidence and narrative; the org's dashboards and systems of record hold the live state.

The maturity gradient mirrors the roadmap: today Arbiter fully serves Junior–Senior *authoring*; the P1 build-out (strategy, plan, traceability, metrics, compliance pack, operational-readiness) is precisely what promotes Arbiter into a genuine Lead → Head-of-QA workbench.

---

## 7. Missing Workflow Integrations

Only integrations that genuinely strengthen Arbiter's grounded-draft / gated-write model. Read-only ones become grounding sources; write ones are WriteGate targets.

| Integration | Direction | Value | Priority |
|---|---|---|---|
| Jira | read (built) → gated write (P3) | Core requirements + defect source of truth; gated ticket/trace/UAT writes. | P1 |
| Xray / Zephyr | gated write | Enables requirement→test→defect coverage-matrix writes; key to closing the traceability gap. | P1 |
| TestRail | gated write + read runs | Push drafted cases; read run results as grounding for release readiness. | P1 |
| GitHub | read + gated write (P2–5) | PR-review/regression-impact grounding on repo rules; PR-linked traceability. | P1 |
| Confluence | read (P2 RAG) | Home for personas, UAT plans, domain docs, knowledge sharing (ACL-mirrored). | P1 |
| OpenAPI / JSON-Schema upload | read (built) | Deepen from substring to structural spec-aware grounding for API-gen and version-diff. | P1 |
| CI systems (GitHub Actions/GitLab CI/Jenkins/CircleCI) | read (JUnit XML, logs, run history) | Grounding for flaky triage, CI-failure triage, regression impact. Pull signals; never orchestrate. | P1 |
| Sentry | read | Highest-signal, lowest-noise grounding for Bug Drafter + Postmortem Drafter (structured errors + release tags). | P1 |
| Datadog / Grafana / Prometheus / Loki / Tempo | read (grounding) → gated write (SLO/alert/synthetic config) | SLOs + post-run metrics ground perf plans and result-to-bug triage; draft alert rules as diff-plans. | P1 |
| axe-core / Lighthouse / Pa11y | read (findings) | Ingest JSON as grounding for the a11y result-to-bug triager. | P1 |
| OWASP ZAP / Burp / Snyk / Semgrep / Dependabot | read (findings) | Ingest security findings for governed bug drafting; scanning stays external. | P1 |
| k6 / JMeter / Gatling / Locust | gated write (export) | Export target for the performance test-plan drafter. | P2 |
| Postman / Newman | gated write | Primary WriteGate target for generated API collections (diff-plan). | P1 |
| Appium / BrowserStack App Automate | gated write (export) + read (results) | Export target for drafted mobile test cases/gesture flows; device execution stays external. | P2 |
| Pact / Pact Broker | read (status) + generate | Draft consumer/provider contracts; broker owns verification state. | P3 |
| Great Expectations / Soda / dbt tests | gated write (export) | Export targets for DQ/DB-assertion drafters; engines execute. | P2 |
| Flyway / Liquibase | read | Changesets as grounding for migration/ETL test-plan generation. | P2 |
| LaunchDarkly / Flagsmith / OpenFeature | read | Flag config as grounding for the flag-matrix/stale-flag workflows; never toggle. | P2 |
| Stryker / PIT / mutmut | read (reports) | Ingest mutation reports for the survivor explainer. | P2 |
| PagerDuty / Opsgenie / incident.io | read (timeline) | Ground postmortems on incident timelines; do NOT let Arbiter page or auto-resolve. | P2 |
| Splunk / Elastic | read (bounded, sanitized slice) | Grounding for the log-triage summarizer; never mirror the store. | P2 |
| Checkly | gated write | Target for gated synthetic-check specs (Playwright-based); Checkly runs and alerts. | P2 |
| Azure DevOps | read + gated write | Mirror the Jira/Xray path so Arbiter is not Jira-only (work items + Test Plans). | P2 |
| Slack / Teams | notify + gated approval | Notify reviewers of Review-Queue items; keeps humans in the loop without weakening the gate. | P2 |
| Phrase / Lokalise / Crowdin | read | i18n key set + locale matrix as grounding for l10n test-case generation. | P3 |
| Gremlin / Litmus / Chaos Mesh / AWS FIS | (plan only) | Execution stays fully external and human-triggered; Arbiter owns the approved plan + audit. | P3 |
| Velero / AWS Backup / cloud DR | (plan only) | Arbiter authors the drill checklist + captures sign-off; mechanics stay external. | P3 |
| Nobl9 | read (later) | Lower priority; draft SLO defs as gated config only, after the observability ground-source layer lands. | P3 |

Explicitly **not** worth integrating as dependencies: Tonic/Gretel/Mostly AI (delegate for scale synthesis, not a runtime dependency of the built-in fixture generator), Monte Carlo/Bigeye (continuous autonomous action), WireMock/Mountebank (Arbiter drafts mock definitions, does not run them), Percy/Chromatic beyond ingesting a diff verdict.

---

## 8. Prioritized Roadmap

Ordered by the composite of business value, productivity gain, low complexity, and market differentiation, weighted by philosophy-fit. Effort is indicative engineering size.

### Wave 1 — Quick wins that extend shipped surface (weeks, highest ROI)
| # | Item | Effort | User impact | Market uniqueness | Philosophy-fit |
|---|---|---|---|---|---|
| 1 | **Operational-Readiness gate (Release Readiness v2)** | S | High — release governance closes the pre-prod→prod gap | Medium | Perfect — extends a shipped workflow, human-owned Go/No-Go unchanged |
| 2 | **NFR Completeness Analyzer** (extend Requirement Analyzer) | S | High — catches the entire non-functional domain at the cheapest point | High — few tools do grounded NFR-gap detection | Perfect — pure drafting, reviewer owns every AC |
| 3 | **Gated Defect Write-Back (WriteGate → Jira)** | M | High — turns the Bug Drafter from copy-paste into a workflow | Medium | Perfect — the canonical WriteGate use case |
| 4 | **Grounded Release-Readiness inputs** | M | High — makes the human decision defensible/auditable | Medium | Perfect — grounding + human decision |

### Wave 2 — Core QE-workbench differentiators (the "QA→QE" leap)
| # | Item | Effort | User impact | Market uniqueness | Philosophy-fit |
|---|---|---|---|---|---|
| 5 | **Test Strategy Generator** | M | High — a QA-architect deliverable done today in ungoverned chat | High — grounded, gated strategy-of-record is rare | Perfect — full pipeline |
| 6 | **Test Plan Generator** (traces to strategy) | M | High | High | Perfect — full pipeline |
| 7 | **Requirements Traceability & Coverage Matrix** | M–L | High — the artifact auditors ask for | Very High — grounded req→test→defect matrix | Perfect — id-aware validator upgrade, read-only default |
| 8 | **Compliance Control-Mapping & Evidence Pack** | M | High — direct healthcare/PHI sales differentiator | Very High | Perfect — read + assemble over immutable audit data |
| 9 | **Quality Metrics Aggregation Layer** | M | High — makes the advertised "quality trend line" real; unlocks reporting/forecasting | High | Enabling infra, **not** a pipeline workflow — deterministic aggregation over captured signals (no generate/validate/gate); identity-consistent (read-only, no ungated write) |

### Wave 3 — CI reliability & operational learning (daily-grind killers)
| # | Item | Effort | User impact | Market uniqueness | Philosophy-fit |
|---|---|---|---|---|---|
| 10 | **CI Failure Triage / Root-Cause Drafter** | M | Very High — hours saved per red build | High | Perfect — facts/hypotheses + human verdict |
| 11 | **Flaky Test Triage & Quarantine Advisor** | M | Very High — the top CI-trust gap | High — grounded, quarantine as gated write | Perfect |
| 12 | **Log/Trace Triage + Incident Postmortem Drafter** | M (needs read-only obs connectors) | High | High — grounding blocks invented stack frames | Perfect — full pipeline |
| 13 | **Read-only observability ground-source connectors** (Datadog/Grafana/Sentry/Splunk) | L | High — substrate for 10–12 | Medium | Substrate, **not** a pipeline workflow — read-only ground-source feeding the *ground* stage; ACL-mirrored, PII-sanitized, identity-consistent |
| 14 | **Incident-to-Regression-Test back-propagation** | M | High — durably hardens the suite; feeds flywheel | High | Perfect — reuses Test Case Generator |

### Wave 4 — API/data & non-functional authoring breadth
| # | Item | Effort | User impact | Market uniqueness | Philosophy-fit |
|---|---|---|---|---|---|
| 15 | **API Test Generator (+ Postman diff-plan)** | M | High — most direct API-domain capability (was P4) | Medium | Perfect — validator blocks invented routes |
| 16 | **Contract Drift / Version-Diff Impact Analyzer** | M | High — reuses schema-grounding + validator directly | High | Perfect |
| 17 | **Synthetic / PII-safe Test Data Generator** | M | High — sanitizer + schema pack make it uniquely safe here | High — PII re-scan gate is the differentiator | Perfect — guardrails are the reason it is safe |
| 18 | **Security Abuse-Case Challenger** | M | High | Medium | Perfect — authoring only |
| 19 | **Accessibility AC & Manual-Script Generator** | M | High | Medium | Perfect — WCAG SC ids are groundable |
| 20 | **Performance Test-Plan Drafter** | M | High | Medium | Perfect — grounded on OpenAPI, export to k6/JMeter |
| 21 | **Non-Functional Result-to-Bug Triager** | M | High — closes the scan→bug loop | Medium | Perfect |

### Wave 5 — Manual/exploratory depth & corpus reasoning (RAG-dependent)
| # | Item | Effort | User impact | Market uniqueness | Philosophy-fit |
|---|---|---|---|---|---|
| 22 | **Exploratory Charter Generator + session structuring** | M | High — replaces ungoverned ChatGPT charter use | Medium | Perfect — edit-diff/dwell feed the flywheel |
| 23 | **UAT Acceptance-Script Generator + sign-off** | M | High — compliance-relevant sign-off evidence | Medium | Perfect — named human sign-off |
| 24 | **Cross-Requirement Inconsistency Checker** (needs P2 RAG) | L | High | High — cite-two-sources guard is distinctive | Perfect |
| 25 | **Spec-Change Impact Analyzer** (needs P2 RAG/staleness) | M–L | High | High | Perfect — routes to Review Queue, no auto-invalidation |
| 26 | **Locale-aware sanitizer recognizers** | M | High — correctness fix to a shipped hard-guarantee control | Medium | Component fix, **not** a pipeline workflow — hardens the *sanitize* stage only; critical to the guarantee Arbiter sells |

### Wave 6 — Broadening authoring (medium ROI, later)
Smoke/Sanity Suite Designer, Persona-Driven Scenario Generator, Mobile Test-Case & Gesture-Flow Generator, Regression Impact Advisor, Mutation Survivor Explainer, Feature-Flag Test-Matrix + Stale-Flag Finder, DQ/DB-Assertion Drafter, Migration/ETL Test-Plan Generator, Resilience/Chaos GameDay Plan Drafter, DR/Backup-Restore Drill Checklist, SRE Runbook Drafter, Gated Ops-Config Drafter, Test Estimation Assistant, Executive Quality-Report Drafter — all **P2**, medium effort, medium value, strong philosophy-fit (grounded draft + gate, execution delegated).

### Deprioritize / delegate (P3 or never)
Defect clustering (high effort, medium value — wait for P2 hybrid retrieval), Consumer-Driven Contract Assistant (delegate broker), Quality-trend forecasting (needs stable metrics history; better delegated), Usability/UX heuristic checklists (low value, authoring-only), Compatibility/device-matrix helper (low value). Everything in Section 4 stays delegated permanently.

**Roadmap logic:** Wave 1 buys immediate credibility by extending shipped workflows; Waves 2–3 are the actual "QA workbench → Quality Engineering workbench" transformation (strategy, plan, traceability, compliance, metrics, CI/operational learning) and carry the strongest differentiation because *grounded + gated + audited* versions of these do not exist in the market; Waves 4–5 broaden coverage into API/data/non-functional/manual once the connector and RAG substrate lands. Three sequenced items (Wave 2 #9 metrics aggregation, Wave 3 #13 observability connectors, Wave 5 #26 locale sanitizer) are **enabling infrastructure/component work rather than pipeline workflows** — they do not pass through generate→validate→gate, and are placed here for sequencing, not as pipeline features. At every step the hard constraints hold: no autonomous releases, no ungated writes, human approval required, every output grounded, every action auditable.