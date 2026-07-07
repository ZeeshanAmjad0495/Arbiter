# Arbiter — Internal AI QA Platform

> **AI drafts, QA owns judgment.** One governed platform for everything a QA engineer does — replacing ad-hoc ChatGPT/Claude chats with project-aware, policy-enforcing, tool-integrated workflows.

Arbiter is an internal tool for QA engineers. Instead of pasting requirements and data into a public chatbot, a QA runs a **workflow** (generate a test case, analyze a requirement, draft a bug, challenge edge cases, summarize a release). Every workflow takes the **same governed path**:

```
sanitize → ground → generate → validate → gate
```

That pipeline is the whole point. It is what makes Arbiter safer *and* more useful than a raw chatbot:

| Stage | What it does | Why it matters |
|---|---|---|
| **sanitize** | Presidio + regex detect PII/secrets; PII is redacted to placeholders, **credentials hard-block** the request | No PHI, member IDs, or API keys ever reach the model |
| **ground** | Assemble a **user-visible** context pack from the project's schema/spec/ticket | The model works from real project facts, not guesses |
| **generate** | Structured output validated against a Zod schema (Anthropic strict tool-use, or Kimi JSON + validate) | No parse failures; typed artifacts |
| **validate** | **Grounding validator** checks every referenced field/endpoint exists in the context | A fabricated field makes the artifact **unexportable** — the anti-hallucination guarantee |
| **gate** | Risk-tiered human review; append-only audit trail + trace | Nothing high-risk ships without a human; everything is auditable |

## What it does (the workflows)

Fourteen QA/QE workflows, all running through the pipeline above, each with paste-in / upload / Jira-fetch context:

1. **Requirement & Ambiguity Analyzer** *(shift-left)* — finds ambiguities, missing acceptance criteria, and testability risks *before code exists*; produces ready-to-send BA/dev questions.
2. **Test Case Generator** — a grounded, structured house-schema test case **with one-click Gherkin**.
3. **Edge-Case Challenger** — adversarial edge cases across a 12-heuristic taxonomy (+ schema-drift, hostile input), with a low-value bucket so volume ≠ coverage.
4. **Bug Report Drafter** — a Jira-ready draft with **facts/hypotheses separated** and explicit severity reasoning.
5. **Release Readiness Summarizer** — a decision-ready summary with a risk table and an explicitly **human-owned** Go / Go-with-risk / No-Go, **grounded in structured release signals** (test-run counts, open-defect counts, eval pass rate) so cited figures can't be invented.
6. **NFR Completeness Analyzer** *(Wave 1)* — audits a requirement across 15 non-functional categories (performance, security, a11y, i18n, reliability, **data integrity**, …) and drafts a testable acceptance criterion for each gap.
7. **Operational-Readiness Gate** *(Wave 1)* — a grounded production-readiness checklist beyond test results (SLOs, runbook, alerts, rollback, on-call, DR, kill-switch, dependencies) with a **human-owned** Go / No-Go.
8. **Test Strategy Generator** *(Wave 2)* — a risk-based strategy (scope, risk areas, test levels + automation split, environments, entry/exit) that a Test Plan traces to.
9. **Test Plan Generator** *(Wave 2)* — an executable plan whose **every scenario traces to a grounded strategy risk-area / requirement id**.
10. **Requirements Traceability & Coverage Matrix** *(Wave 2)* — **id-aware** links from requirement ids to covering test ids, surfacing uncovered requirements and orphan tests; invented ids block export.
11. **Compliance Control-Mapping & Evidence Pack** *(Wave 2)* — maps framework controls (HIPAA/SOC 2) to a feature (satisfied vs. gap, required evidence, verification), control ids grounded, **human-attested**.
12. **CI Failure Triage** *(Wave 3)* — classifies a CI failure (product bug / flaky / infra / dependency / config) with ranked root-cause hypotheses **grounded in the log**; never re-runs or changes CI.
13. **Flaky Test Triage & Quarantine Advisor** *(Wave 3)* — diagnoses flakiness patterns from run history and **drafts** quarantine candidates (a human applies them via a gated WriteGate — Arbiter never quarantines).
14. **Incident Postmortem Drafter** *(Wave 3)* — a blameless postmortem (timeline, root cause, typed action items) that **back-propagates regression tests** so the incident can't silently recur.

Plus the platform features around them:

- **Review Queue** — non-auto-approved artifacts wait for human approval; the reviewer edits, and the **edit-diff + dwell-time are captured** (the feedback-flywheel signal). High/medium risk require pre-approval.
- **Export** — Markdown / JSON / CSV / Gherkin for any artifact.
- **Prompt Library** — versioned **6-component templates** (Role · Context · Instruction · Constraints · Output format) seeded from the training-doc A1–A8 pack; the single source of truth each workflow's prompt is composed from.
- **Grounding sources** — upload an **OpenAPI/JSON-Schema** spec or **fetch a Jira ticket by key** (read-only) to ground generation against real project facts.
- **Eval gate** — code-based graders run every workflow through the pipeline in CI (`pnpm eval`) and block regressions.

## Why this beats "QAs just use ChatGPT"

- Enforced sanitization — no pasted PHI/credentials, ever.
- **Grounding validation** — invented field names/endpoints are mechanically caught and blocked from export.
- Governance in the request path (sanitize, review gates, audit trail) — not in a training doc.
- Team compounding — shared prompt templates, captured reviewer edits, a quality trend line.

## Quick start (offline — no keys, no Docker)

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm eval
pnpm dev:api    # API on :4310 (in-memory, regex sanitizer, stub LLM)
pnpm --filter @arbiter/web dev   # UI on http://localhost:5173
```

With none of the env vars set, everything runs fully offline (in-memory repos, regex sanitizer, deterministic stub LLM, in-memory tracer) — so `pnpm test`/`pnpm eval` are hermetic and the whole app is demoable with zero infra.

## Real providers & services (opt-in via `.env`)

Copy `.env.example` to `.env` and set what you need — each dependency flips from offline to real when its vars appear:

- **LLM** — set `ANTHROPIC_API_KEY` (Claude cascade) **or** `KIMI_API_KEY` (Kimi/Moonshot; `kimi-k2.6`/`k2.7-code` with thinking). Kimi takes precedence when both are set.
- **Postgres** (`DATABASE_URL`) — persistence + Row-Level Security. `pnpm docker:up && pnpm migrate`.
- **Presidio** (`PRESIDIO_ANALYZER_URL` / `_ANONYMIZER_URL`) — real PII/secret detection.
- **Jira** (`JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN`) — read-only fetch-by-key.

The header mode pills show which path is live (green = real service).

## Architecture

```
Next-gen SvelteKit UI (Workbench · Review Queue · Prompt Library)
        │  (Vite dev proxy → API, or served static in prod)
Fastify API  ──  GET /v1/workflows · POST /v1/workflows/:id/run
                 GET /v1/reviews · POST /v1/artifacts/:id/review
                 GET /v1/prompts · GET /v1/jira/:key
                 GET /v1/projects · POST /v1/projects   (x-arbiter-project scopes every call)
        │
GuardrailEngine:  sanitize → ground → generate → validate → gate
        │              │           │          │          │
   @arbiter/sanitize   │      @arbiter/llm    │     review gate
   (Presidio+regex,    │   (Anthropic/Kimi/   │   (risk-tiered)
    de-mask store)     │       stub)          │
        │        context pack           grounding validator
   @arbiter/db (Postgres + RLS  |  in-memory) · @arbiter/telemetry (OTel-shaped spans)
```

Every external dependency sits behind an interface with a **real impl and an offline impl**, chosen by config — that is why the platform runs with zero infra and flips to production services by env var alone.

### Packages

| Package | Responsibility |
|---|---|
| `@arbiter/core` | Zod domain contract, error taxonomy, Result, ids, diff/hash utils |
| `@arbiter/config` | Typed env config; decides real-vs-offline mode per dependency |
| `@arbiter/telemetry` | OTel-shaped tracer + GenAI semantic-convention keys |
| `@arbiter/db` | Repositories (Postgres + in-memory), migrations, **RLS** isolation |
| `@arbiter/sanitize` | Presidio client + regex recognizers + credential hard-block + encrypted de-masking store |
| `@arbiter/llm` | Anthropic + Kimi + deterministic stub providers |
| `@arbiter/guardrail` | The pipeline: grounding validator, review gate, orchestrator (spans + audit) |
| `@arbiter/workflows` | The 14 workflows, the workflow registry, the 6-component prompt templates |
| `@arbiter/api` | Fastify service (workflows, review queue, prompts, Jira) |
| `@arbiter/web` | SvelteKit UI |

## Governance & security (by construction)

- **Sanitization** on every call — default-deny on uncertain fields; credentials hard-block + rotate-alert; credentials are *never* stored.
- **Grounding validation** — ungrounded references block export.
- **Risk-tiered review** — high/medium pre-approval, low sampled post-hoc; reviewer edit-diffs and dwell-time captured as tripwires + flywheel signal.
- **Multi-tenant isolation** — mandatory `project_id` filters + Postgres `FORCE ROW LEVEL SECURITY` (fail-closed) backstop. The active project is selected per request (`x-arbiter-project` header / UI switcher) and threaded into every repo call, which sets the RLS GUC per transaction — a caller cannot read or write across the project boundary (HTTP-level isolation test in `tests/projects.test.ts`).
- **Append-only audit trail** — who prompted, which sources, which prompt/model version, who approved which change — exportable as compliance evidence.
- **Encrypted de-masking store** (AES-256-GCM) with retention control, for re-hydrating approved outputs.

## Status

**Shipped (Waves 0–3):** the governed workbench — guardrail spine, **fourteen workflows**, review queue (+ edit-diff/dwell capture), 6-component prompt library, eval gate in CI, read-only OpenAPI + Jira grounding, and an adversarially-reviewed security/PHI/DB hardening pass. **Wave 1** added the NFR Completeness Analyzer, Operational-Readiness Gate, and grounded Release-Readiness inputs; **Wave 1.5** exposed the multi-project surface; **Wave 2** added the Test Strategy & Test Plan Generators, the id-aware Requirements Traceability & Coverage Matrix, the Compliance Control-Mapping & Evidence Pack, and the **Quality Metrics Aggregation Layer** (`/insights`).

The roadmap has been **re-planned around the QA→QE gap analysis** into value-ordered **Waves** — see **[`docs/ROADMAP.md`](docs/ROADMAP.md)** and **[`docs/QA-GAP-ANALYSIS.md`](docs/QA-GAP-ANALYSIS.md)**. Next: **Wave 4** (API test generation + contract-drift, PII-safe synthetic test data, security abuse-case challenger, accessibility & performance authoring).

**Read-only Jira — enforced in code:** Arbiter never writes to the connected Jira workspace; every Jira request refuses any method but GET/HEAD before it is sent.

**Deliberately not building** (integrate/delegate instead): test *execution* (Playwright/k6/Appium), self-healing locators, visual-AI diffing (Percy/Chromatic), predictive test-selection ML, fine-tuned models, browser-agent regression gates, GraphRAG, code embeddings, homegrown prompt-registry/eval engines.

## Verify

```bash
pnpm typecheck        # tsc, whole monorepo
pnpm test             # vitest — sanitizer, grounding, review flow, providers
pnpm eval             # code-based grader gate across all workflows
pnpm --filter @arbiter/web check   # svelte-check
```

---

Built with the Anthropic/Claude and Kimi (Moonshot) APIs. Deployment target: GCP (Cloud Run + Cloud Build + Cloud SQL), matching existing company infra.
