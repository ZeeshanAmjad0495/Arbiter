# Arbiter — Security & Correctness Audit

**Scope:** ~16.7k LOC across 11 packages/apps (`packages/*`, `apps/api`, `apps/web`).
**Method:** manual code audit against the product invariants in `CLAUDE.md`, with each
finding verified against the actual source — and, where possible, proven empirically by
running the real code rather than by reading alone.

## Executive summary

The codebase is, on the whole, **carefully built and defensively designed**. Tenant
isolation, the read-only connector rule, the write-gate, and the sanitizer's redaction
algorithm all hold up under inspection. There is no XSS surface at all.

However, the audit found **one critical and two high-severity defects**, all of which
undermine invariants the product explicitly claims:

1. **Grounding is a silent no-op for 19 of 39 workflows** — proven with 228 real runs.
2. **A PEM private key bypasses the credential hard-block** and is sent verbatim to the
   third-party model — proven by executing the pipeline.
3. **A credential reset does not revoke sessions**, so a stolen session survives the
   documented remediation for up to 7 days.

The through-line is **failing open**: in each case the control silently does nothing and
reports success, rather than refusing. That is the most dangerous failure mode for a
system whose value proposition is governance.

| Severity | Count |
| --- | --- |
| Critical | 1 |
| High | 2 |
| Medium | 2 |
| Low | 2 |

---

## Critical

### C1. Grounding is a silent no-op for 19 of 39 workflows

**File:** `packages/guardrail/src/pipeline.ts:266` (root cause); `packages/workflows/src/registry.ts`

```ts
const claims = req.extractClaims ? req.extractClaims(generation.output) : [];
```

`extractClaims` is **optional** (`pipeline.ts:50`). When a workflow does not define it,
`claims = []` → `violations = 0` → `blockedExport = false`. The grounding gate becomes a
no-op, and the API reports `grounding.violations: 0`, which reads as *"verified grounded"*
when it actually means *"never checked"*.

**19 of 39 workflows define no `extractClaims`:**
`requirement-analyzer`, `edge-case-challenger`, `bug-report`, `nfr-analyzer`,
`operational-readiness-gate`, `incident-postmortem`, `security-abuse-cases`,
`exploratory-charter`, `smoke-suite`, `migration-test-plan`, `exec-quality-report`,
`accessibility-ac`, `nfr-result-triage`, `persona-scenarios`, `mobile-test-cases`,
`chaos-gameday`, `dr-drill`, `sre-runbook`, `ops-config`.

**Empirical proof** (from `evals/reports/zuub-e2e-report.json`, 468 real-LLM runs):

| group | runs | total grounding violations |
| --- | --- | --- |
| the 19 workflows **without** `extractClaims` | 228 | **0** |
| the 20 workflows **with** `extractClaims` | 238 | **187** |

Zero violations across 228 real runs is not evidence of well-grounded output; it is the
signature of a control that never executes.

**Failure scenario:** A QA engineer runs `bug-report` on a Zuub ticket. The model
hallucinates an endpoint `/v1/claims/refund` and a field `refund_status` that exist in no
context item. `extractClaims` is undefined, so nothing is checked; `blockedExport` is
`false`; a low-risk tier auto-approves. The fabricated bug report is exported to a human
as a grounded, approved artifact. This directly contradicts *"every output grounded"* and
*"an invented field is unexportable."*

**Remediation:** Make the pipeline **fail closed**. Either (a) refuse to run a workflow
that declares no `extractClaims`, or (b) represent "not checked" as a distinct grounding
status that blocks export / forces human review — never as `violations: 0`. Then add
`extractClaims` to the remaining 19 workflows. The one-line default is the root cause.

---

## High

### H1. PEM private keys bypass the credential hard-block and reach the model

**File:** `packages/sanitize/src/recognizers.ts:37-91`

`CREDENTIAL_TYPES` hard-blocks `API_KEY`/`JWT`/`PASSWORD`/`GENERIC_SECRET`, and coverage is
good for `sk-…`, Stripe `sk_live_…`, AWS `AKIA…`, Google `AIza…`, GitHub `ghp_…`, Slack
`xox…`, `Bearer …`, and `password:`/`secret:` forms. **There is no recognizer for a PEM
private key block.** A raw `-----BEGIN RSA PRIVATE KEY-----` matches nothing: it has no
`secret:`/`token:` prefix, is not base64-JWT shaped, and the digit-run recognizers are
Luhn-validated.

**Empirical proof** — POSTing a requirement containing a (fake) PEM key to the real
pipeline returned:

```
blocked: False
findings: []                      # zero recognizers fired
reached model (output produced): True
BEGIN RSA PRIVATE KEY still in sanitizedText: True
```

**Failure scenario:** An engineer pastes a deploy key or portal private key into a ticket
body or a requirement. The sanitizer detects nothing, does not block, and the **private key
is transmitted verbatim to the third-party model provider** (Kimi / DeepSeek / Anthropic)
and stored in the context pack. The invariant *"a live secret hard-blocks before the model
call"* fails for the most sensitive credential class there is. Neither `pnpm eval` nor
`pnpm eval:redteam` covers PEM, so the suite stays green.

**Remediation:** Add one recognizer (block on the header alone, so a truncated body still
trips it):

```ts
{ type: 'GENERIC_SECRET',
  pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/g, score: 0.99 },
```

and add a PEM case to the red-team suite.

### H2. A credential reset does not revoke sessions

**Files:** `apps/api/src/auth.ts:36-49` (`issueKey`), `auth.ts:56-62` (`rotateKey`),
`packages/db/src/types.ts:51-57` (`SessionRepository`)

`SessionRepository` exposes only `create`, `getByTokenHash`, `delete(id)`, `deleteExpired`
— there is **no delete-by-user**. Both reset paths replace `accessKeyHash` and never touch
sessions. The code states it plainly at `auth.ts:54`:
*"existing sessions (opaque tokens) stay valid."*
`ARBITER_SESSION_TTL_HOURS` defaults to **168 (7 days)** (`packages/config/src/index.ts:85`).

**Failure scenario:** An attacker intercepts a user's emailed temporary invite key and calls
`POST /v1/auth/login`, receiving a session token valid for 7 days. The user notices and
follows the documented remediation — email the admin, who re-issues via
`POST /v1/auth/issue-key`; and/or the user calls `POST /v1/auth/rotate-key`. Both rotate the
key hash; **neither deletes the attacker's session row**. The attacker retains full API
access at their role for up to 7 days. The remediation path provides no eviction — which is
the entire purpose of a credential reset.

**Remediation:** Add `SessionRepository.deleteByUser(userId)` (memory + Postgres) and call it
from both `rotateKey` and `issueKey`; expose an admin "revoke all sessions" action. ~15 lines.

---

## Medium

### M1. Substring grounding yields false "grounded" verdicts

**File:** `packages/guardrail/src/grounding.ts:32`

```ts
const idx = haystack.findIndex((h) => h.includes(needle));
```

Matching is a raw case-insensitive substring test with **no word boundary**. An invented
field `paid` is "grounded" by a context containing `paid_amount`; `id` is grounded by almost
any text; `coverage` by `coverage_status`.

**Failure scenario:** The model invents field `paid` for a claims workflow. Context contains
`Fields: paid_amount, claim_status`. `"fields: paid_amount, claim_status".includes("paid")`
is `true` → status `grounded` → exported. So even the 20 workflows that *do* check can pass
invented claims. The file documents this as a deliberate "Phase 0" approach, but the
product invariant language ("an invented field is unexportable") overstates what substring
matching delivers.

**Remediation:** Require a token/word-boundary match (e.g. `\b<needle>\b` on tokenized
context), or move to the schema/spec-aware validator the interface was designed for.

### M2. The plaintext admin access key is written to logs on first boot

**File:** `apps/api/src/main.ts:43`

```ts
console.log(`\n🔑  Arbiter admin login\n    email: ${adminEmail}\n    key:   ${key}\n ...`);
```

Convenient in dev; in a deployed environment stdout is captured by log aggregation
(Loki/CloudWatch), so a **plaintext admin credential is persisted to log storage** and to
anyone with log read access. Violates *"never commit/log secrets."* (Fires only on first
boot, when the admin has no key yet — but that is exactly the production bootstrap.)

**Remediation:** Print only when `NODE_ENV !== 'production'`; in production require an
out-of-band bootstrap (env-provided key hash, or a one-time CLI that writes to a file with
0600).

---

## Low

### L1. `deleteExpired` is implemented but never called

**Files:** `packages/db/src/memory.ts:218`, `packages/db/src/postgres.ts:226` — zero call
sites anywhere. Expired sessions are pruned only if that exact token is presented again
(`auth.ts:102-104`), so the sessions table grows unbounded with expired rows holding
`tokenHash` + `userId`. Either schedule it (as the de-mask purge CLI is) or delete the
method.

### L2. `issueKey` silently ignores `role` for an existing user

**File:** `apps/api/src/auth.ts:42` — `role: existing?.role ?? role`. The endpoint accepts a
`role` (`server.ts:306`) but discards it for existing users. An admin re-inviting a `qa` user
as `qa_lead` gets a silent no-op. This **fails safe** (no escalation), but is misleading.
Reject with a 409, or document that role changes go through `/v1/admin/users/:id/role`.

---

## What holds up well

These were specifically probed and found sound:

- **Multi-tenant isolation / Postgres RLS** — project scoping is a mandatory parameter on
  every repository call; `FORCE ROW LEVEL SECURITY` + the per-transaction
  `app.arbiter_project_id` GUC via `withProjectTx`. No unscoped tenant query found.
- **Read-only connectors & the write-gate** — the connectors refuse non-GET/HEAD
  structurally, before a request is issued; the WriteGate hard-refuses the connected Jira.
- **No XSS surface** — `{@html}` does not appear anywhere in `apps/web`; no unsafe sinks.
- **Sanitizer core algorithm** (`packages/sanitize/src/core.ts`) — merges *all* overlapping
  matches and redacts the union (no raw remainder leak); a credential type wins the merge;
  a belt-and-suspenders `hasRawCredential` check blocks independent of merge outcome;
  credentials are never persisted to the de-mask store; the audit hash is taken over the
  **sanitized** text so a low-entropy PHI value can't be brute-forced. This is good work.
- **Auth primitives** — 192/256-bit random keys and tokens, constant-time `timingSafeEqual`
  compares, and a deliberate always-hash path that removes the email-enumeration timing
  oracle (`auth.ts:68`, `auth.ts:92`).
- **Production guard** — `ARBITER_DEMASK_KEY` is required in production, refusing to store
  the de-mask PII map unencrypted (`packages/config/src/index.ts:167`).
- **No meaningful silent failures** — the only empty catches are `rm()` temp-dir cleanups.

## Coverage note

Lenses completed: guardrail/grounding, PII sanitizer & credential hard-block, auth/sessions,
crypto & secret logging, web XSS, silent failures, multi-tenant RLS, read-only connectors,
config production guards. Not yet swept in depth: workflow prompt-injection surface,
core schema/branded-id spoofing, migration safety, and dependency supply chain.
