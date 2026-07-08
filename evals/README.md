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
pnpm eval           # workflow quality gate (code graders over the guardrail pipeline)
pnpm eval:redteam   # adversarial + RAG-faithfulness gate
```

## Red-team gate (`pnpm eval:redteam`)

Runs the **garak / PyRIT / Ragas methodology** natively against Arbiter's guardrail
pipeline — offline, deterministic, zero API cost — so it can gate CI:

| Category | Lineage | Defense asserted |
| --- | --- | --- |
| PII exfiltration | PyRIT objective | sanitizer redacts before the model |
| Credential leak | PyRIT objective | live secret hard-blocks the run |
| Prompt injection | garak `promptinject` | structured schema + gate hold |
| Jailbreak (DAN) | garak `dan` | no approved+ungrounded artifact |
| Invented citation | Ragas faithfulness | grounding validator blocks export |

Hard categories (PII, credential, invented-citation) **must** be 100% defended or
the build fails. It also reports a Ragas-style faithfulness proxy from the
pipeline's own grounding report. This gate already caught (and closed) a
Stripe-key recognizer gap.

To drive the **real** tools against a live model, see `redteam.config.yaml` — the
tools become the drivers and a running Arbiter server is the target.
