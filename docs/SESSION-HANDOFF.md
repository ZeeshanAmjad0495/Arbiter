# Arbiter — session handoff

State as of the last commit on `main`. Written to disk deliberately: conversation context
does not survive a compact, files do.

## What Arbiter is

A governed internal AI QA/quality-engineering platform. The product promise is **"AI drafts,
humans approve"** — every output grounded, every action audited, every write gated,
read-only by default. Its invariants live in `CLAUDE.md` and are the thing worth protecting;
most defects found so far are invariants that quietly don't hold.

## Current state (all green, all pushed)

`pnpm typecheck` · **149 tests** · `pnpm eval` (204 checks) · `pnpm eval:redteam` (5/5) ·
`pnpm test:llm` (promptfoo 3/3) · `pnpm e2e` (Playwright 16/16 incl. axe a11y) ·
`pnpm --filter @arbiter/web run check` (0/0). Lighthouse a11y/best-practices/SEO **100**.

## Architecture map (read this first)

A pnpm monorepo, ~16.7k LOC. It is **ports-and-adapters**, not a jumble — each seam has an
interface plus a real and an offline adapter, which is why CI runs with no services or keys:

| package | role | key seam |
| --- | --- | --- |
| `packages/core` | zod schemas, branded ids | `Artifact`, `ProjectId`… |
| `packages/config` | env → typed config | provider precedence |
| `packages/db` | repositories | `RepositoryBundle` — memory ⇄ postgres (RLS) |
| `packages/guardrail` | the pipeline | `pipeline.ts`, `grounding.ts`, `writegate.ts`, `graph.ts` |
| `packages/llm` | model providers | `LlmProvider` — anthropic/kimi/openai-compat/stub |
| `packages/sanitize` | PII + secrets | `core.ts`, `recognizers.ts`, `demask.ts` |
| `packages/workflows` | the 39 workflows | `registry.ts` (2.7k LOC), `prompts.ts` |
| `apps/api` | Fastify HTTP | `server.ts` (~1k LOC), `auth.ts` |
| `apps/web` | SvelteKit UI | `routes/*`, `lib/components/*` |

Pipeline (one synchronous transaction): **sanitize → ground → generate → validate → gate**.

## Audit — see `docs/AUDIT.md`

**1 critical, 2 high, 2 medium, 2 low.** The through-line is **failing open**: the control
silently does nothing *and reports success*.

- **C1 (critical)** — grounding is a **no-op for 19 of 39 workflows**. `extractClaims` is
  optional; `pipeline.ts:266` defaults to `[]` → `violations=0` → `blockedExport=false`,
  reported to clients as `grounding.violations: 0` (reads as *verified*, means *never
  checked*). Proven across **two providers**: the 19 produced 0 violations in 228 runs on
  each of Kimi and DeepSeek (456 runs); the other 20 produced 187/206. Structural, not
  probabilistic.
- **H1 (high)** — a **PEM private key** matches no recognizer, so it is not hard-blocked and
  is sent verbatim to the third-party model. Proven by running the pipeline:
  `blocked=False`, `findings=[]`, key intact in `sanitizedText`. Fix ≈ 2 lines.
- **H2 (high)** — a **credential reset does not revoke sessions** (no delete-by-user on
  `SessionRepository`); with a 7-day TTL a stolen session outlives the documented
  remediation. Fix ≈ 15 lines.
- **M1** substring grounding false-positives (`paid` grounds against `paid_amount`).
  **M2** plaintext admin key logged on first boot. **L1** `deleteExpired` never called.
  **L2** `issueKey` silently ignores `role` for existing users.

**Lenses still un-swept:** workflow prompt-injection surface, branded-id spoofing,
migration safety, dependency supply chain.

Verified **sound**: tenant isolation/RLS, read-only connectors + write-gate, zero `{@html}`
(no XSS surface), the sanitizer's union-redaction core, timing-safe auth primitives.

## Shipped this session

- Gated write-back UI; interactive Concept Map + graph-extraction reliability fixes.
- Zuub E2E: offline CI suite + real-LLM runner (`pnpm zuub:e2e`).
- Full CI suite: Playwright E2E + axe a11y + API-contract; promptfoo LLM-output tests.
- **DeepSeek** provider (see below) — full 468-run matrix **468/468, zero errors**.
- Review UX: documents instead of raw JSON, independent scroll, and the request/purpose/
  human-label context (below).

## Key decisions + rationale

- **DeepSeek over Kimi.** Kimi ran out of balance. DeepSeek is plain OpenAI-compatible
  (reasoning is picked via the model name, not a request flag) so it **reuses
  `OpenAICompatProvider`** — config + one branch, no new client. Precedence is
  `DeepSeek > Kimi > Anthropic > LiteLLM > stub`, so the live key wins without editing
  `.env`. `deepseek-v4-pro` is real and ~2× faster than Kimi (406s vs 844s for 468 runs).
  Caveat: it is a **reasoning model** — reasoning tokens count against `max_tokens` (8192).
- **The requirement was recorded nowhere.** The audit trail held only counts/verdicts, so a
  reviewer literally could not see what they were approving. Now the **sanitized**
  requirement is stored on the `sanitize` audit event (never raw — the de-mask vault stays
  the only PII sink) and surfaced via `GET /v1/artifacts/:id → request`.
- **Monorepo vs microservices — open.** The user wants to split frontend/backend into
  separate repos with a microservices architecture. Recommendation on record: **don't**,
  and the reasoning is in the conversation — it would break the shared branded types
  (weaker types across repos), gut the in-process test strategy (`app.inject`, keyless CI),
  and split a synchronous pipeline across network hops for no benefit at 16.7k LOC / one
  team. What the user actually wants (maintainability, onboarding) is achievable by fixing
  the real defects below. **This is the user's call and it is not yet made.**

## Valid maintainability complaints (agreed, not yet done)

- **48 `console.*` calls** (17 in `packages/workflows`, 16 in `apps/api`) while pino is
  already available via Fastify's `app.log` and used in only ~3 places. Library packages
  should take an injected logger, not own I/O.
- **`registry.ts` is 2,717 lines** (all 39 workflows in one file); `prompts.ts` 729.
- `apps/web/src/routes/graph/+page.svelte` (721) mixes simulation + interaction + styles.

## Open work, in the user's order

1. Finish the 4 remaining audit lenses.
2. Fix C1 / H1 / H2.
3. Refactor: structured logging, split the two oversized files, onboarding docs — plus the
   microservices/separate-repos decision.
4. Leftover: the two UI issues are fixed; duplicate empty projects deleted.

## Gotchas / environment

- **Projects**: `Zuub` = the real corpus (**12,174 docs, 600 graph nodes, 0 artifacts**).
  `Zuub E2E` = 12 synthetic tickets but **433 artifacts**. To review real drafts grounded in
  complete data, run `pnpm zuub:e2e --persist --project Zuub`.
- **Env naming**: the DeepSeek vars are `DEEP_SEEK_*` (underscore), not `DEEPSEEK_*`.
- **Local UI**: `pnpm dev:api` (4310) + `pnpm --filter @arbiter/web dev` (5173).
  Admin login `admin@arbiter.local`; access keys are hashed, so a lost key must be re-issued
  via `AuthService.issueKey`.
- `pnpm zuub:e2e` defaults to an **ephemeral** store; `--persist` writes to real Postgres.
