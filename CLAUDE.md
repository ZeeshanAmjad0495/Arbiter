# Arbiter — project rules

Non-negotiable operating rules for this repo. These override defaults.

## Product invariants
- AI drafts, humans approve. Every output grounded, every action audited, every write gated, read-only by default.
- **Never write to the connected Jira workspace.** All Jira calls are read-only (enforced in `jiraReadOnlyFetch`). Write-back, if ever, goes only to a sandbox/GitHub target via the human-approved WriteGate.
- Never commit secrets. Access keys are sha256-hashed; PII in the de-mask vault is encrypted at rest.

## Engineering rules
- **No paid services.** Use open-source or free tools/services only. The sole exceptions are **LLMs** and **Cloud hosting** (when we deploy). Do not introduce TestRail, Xray, Percy, or any paid SaaS — pick a free/OSS equivalent (GitHub, GitLab, Gitea, pgvector, Transformers.js, garak, k6, Playwright, etc.).
- **Don't reinvent the wheel.** If a maintained tool/package already solves it, use it. Prefer the smallest correct change.
- **DRY / minimal code.** No boilerplate or speculative abstractions. The same behavior in less code is better. Reuse existing components (e.g. `Modal.svelte`, `ConfirmDialog.svelte`, the offline-first `real ⇄ offline` seam pattern).
- **Offline-first.** Every external dependency has a real impl + a deterministic offline/stub impl chosen by config, so tests/CI run with no services or keys.

## UI rules
- **Never use browser dialogs** (`window.confirm` / `alert` / `prompt`) anywhere — they're unprofessional. Use a modal (`ConfirmDialog.svelte`).
- **Destructive actions** (any delete/purge) must: open a confirmation modal, require the user to **re-enter their access key** (backend step-up via `AuthService.verifyKey`), and require an explicit acknowledgement (double confirm).
- **Back up before destroying.** Snapshot exactly what's being deleted first — compressed, recoverable, AWS-snapshot style (`writeSnapshot`, gzip → `ARBITER_BACKUP_DIR`). Never back up plaintext PII (de-mask backs up ciphertext only).
- Keep every page accessible (Lighthouse 100 a11y/best-practices/SEO).

## Definition of done (gate before every push)
`pnpm typecheck` · `pnpm test` · `pnpm eval` · `pnpm eval:redteam` · `pnpm --filter @arbiter/web run check` — all green. Push each unit to `main`.
