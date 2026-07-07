# Evals

The LLM eval workbench (§6) and the agent-quality CI gate (§7) live here.

**Phase 0 (now):** a scaffold — `promptfooconfig.yaml` documents the grading
contract for the hello workflow. Not yet wired into CI.

**Phase 1:** 20–30 real-failure-derived cases per workflow, graded by code-based
graders first (AC coverage, negative/boundary presence, no-fabricated-reference)
then rubric judges, run as a Cloud Build gate on every prompt/model change.

**Phase 3–4:** the full workbench — golden datasets, calibrated LLM-as-judge,
Ragas diagnostics, statistical gating (n≥5, bootstrap CIs), OWASP LLM red-team.

Run locally:

```bash
pnpm eval
```
