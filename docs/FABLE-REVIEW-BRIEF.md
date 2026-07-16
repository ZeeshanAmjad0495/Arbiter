# Review brief for Fable

Paste the block below. Context on the framing: this is a **maintainer reviewing their own
codebase to fix defects** — an ordinary engineering code review. It is described plainly,
because that is what it is. Nothing here asks for offensive tooling, exploitation, or work
against a system we don't own; the goal throughout is *remediation of our own code*.

---

## Prompt

I'm the maintainer of **Arbiter**, an internal AI quality-engineering platform, and I want a
rigorous code review of my own codebase so I can fix what's wrong. Repo root is this
directory. Please read the code before concluding anything — I want findings anchored to
`file:line` with the offending code quoted, not impressions.

**Start with `docs/SESSION-HANDOFF.md`** — it has the architecture map, the current state,
and the decisions already taken. Then `CLAUDE.md` for the product invariants, and
`docs/AUDIT.md` for the defects a previous review already found (don't re-report those;
do tell me if you think any are wrong).

### What the codebase is

A pnpm monorepo, ~16.7k LOC, ports-and-adapters: `packages/core` (zod schemas, branded ids),
`config`, `db` (repositories, memory ⇄ postgres with row-level security), `guardrail` (the
pipeline), `llm` (model providers), `sanitize` (PII redaction), `workflows` (39 workflow
definitions), `apps/api` (Fastify), `apps/web` (SvelteKit). The core pipeline is one
synchronous transaction: sanitize → ground → generate → validate → gate.

The product promise is "AI drafts, humans approve": every output grounded in supplied
context, every action written to an audit log, every external write behind a human approval
gate, read-only by default, and personal data redacted before it reaches a model. Most
defects found so far are cases where one of those guarantees quietly doesn't hold — the
control does nothing and still reports success. That **fail-open** pattern is the thing I
most want you to hunt for.

### What I want reviewed

1. **Correctness of the guarantees.** Where can a control silently not run, or report
   success without doing its job? Especially: the grounding check, the redaction step, the
   approval gate, and the per-tenant data isolation.
2. **TypeScript and framework quality.** Type-safety holes (`any`, unchecked casts, branded
   types being bypassed), zod validation gaps at trust boundaries, async correctness
   (unawaited promises, races), error handling that swallows failures.
3. **Maintainability.** I already know about these — tell me if you'd prioritise
   differently, and what else:
   - 48 `console.*` calls, while pino is already available via Fastify's `app.log` and used
     in ~3 places. Library packages own I/O instead of taking an injected logger.
   - `packages/workflows/src/registry.ts` is 2,717 lines (all 39 workflows in one file).
   - `apps/web/src/routes/graph/+page.svelte` is 721 lines mixing simulation, interaction
     and styling.
4. **Onboarding.** What would waste a new developer's first day here?
5. **An architecture question I want a second opinion on.** There's a proposal to split the
   frontend and backend into separate repositories and move to microservices. My analysis
   says no at this size (one team, 16.7k LOC): it would weaken the end-to-end type safety
   the shared `@arbiter/core` branded ids provide, break a test strategy that currently runs
   the whole API in-process with no services or keys, and split a synchronous pipeline
   across network hops for no benefit — and that the real problems are the oversized files
   and the logging, not the module boundaries. **Argue the other side if you think I'm
   wrong**, and say what evidence would change the answer.

### Ground rules

- Read the actual code; quote it. If you can't prove a claim from the source, say so.
- No style nits. I want defects, and things that will cost real time later.
- An empty finding list for an area is a useful result — say "this holds up" and why.
- Rank by severity and give a concrete, minimal fix for each.
- Where you disagree with the existing audit or with my architecture view, say so directly.
