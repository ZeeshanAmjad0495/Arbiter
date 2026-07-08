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

## Real tools against a live model

The offline gate proves the guardrail. To probe the live **model**, the actual
Python tools drive a running Arbiter server (`redteam.config.yaml` is the map):

```bash
# 0. run the API + grab a session token
pnpm --filter @arbiter/api dev
export ARBITER_TOKEN=$(curl -s -XPOST localhost:4310/v1/auth/login \
  -H content-type:application/json -d '{"email":"admin@arbiter.local","key":"<key>"}' | jq -r .token)
export ARBITER_PROJECT=00000000-0000-4000-8000-000000000001

# 1. Ragas — faithfulness / answer-relevancy / context-precision
pnpm eval:export-ragas                     # → evals/ragas-dataset.jsonl (offline, reproducible)
pip install ragas datasets && python evals/ragas_eval.py

# 2. garak — prompt-injection / jailbreak / leak probes (fill the token/project in the JSON)
envsubst < evals/redteam.garak.json > /tmp/arbiter.garak.json
python -m garak --model_type rest -G /tmp/arbiter.garak.json \
      --probes promptinject.HijackHateHumansMini --generations 1   # widen probes as needed

# 3. PyRIT — objective-driven red-team orchestration
python evals/pyrit_redteam.py
```

Install the tools once (open-source): `pip install -r evals/requirements.txt`. garak
and PyRIT run as shown. **Ragas** currently conflicts with the pinned langchain in
some environments (`langchain_community.chat_models.vertexai` was moved); the native
`pnpm eval:redteam` already computes a Ragas-style faithfulness proxy with no Python
dependency, so use that for the gate and run the Python Ragas only when its deps align.

Every response the tools see is already guardrail-filtered, so they measure the
**defended** surface end to end. `evals/ragas-dataset.jsonl` is committed as a
reproducible sample; regenerate it any time with `pnpm eval:export-ragas`.
