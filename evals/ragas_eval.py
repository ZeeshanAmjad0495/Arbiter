#!/usr/bin/env python3
"""Score an Arbiter-exported dataset with Ragas.

Reads evals/ragas-dataset.jsonl (from `pnpm eval:export-ragas`) and scores
faithfulness / answer-relevancy / context-precision.

Setup (Ragas gets its own venv — see evals/requirements-ragas.txt):
    python3.12 -m venv .venv-ragas && . .venv-ragas/bin/activate
    pip install -r evals/requirements-ragas.txt
    python evals/ragas_eval.py

Ragas uses a judge LLM + embeddings. With OPENAI_API_KEY set it scores; otherwise it
verifies the import + dataset load and tells you what to set (you can point
langchain-openai at any OpenAI-compatible endpoint, e.g. Kimi, via OPENAI_BASE_URL).

The native `pnpm eval:redteam` already computes a Ragas-style faithfulness proxy from
the guardrail grounding report with no Python dependency — that's the CI gate.
"""
import json
import os
import sys
from pathlib import Path

try:
    from datasets import Dataset
    from ragas import evaluate
    from ragas.metrics import answer_relevancy, context_precision, faithfulness
except ImportError as e:
    sys.exit(f"Ragas not importable ({e}). Install with:  pip install -r evals/requirements-ragas.txt")


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "ragas-dataset.jsonl"
    if not path.exists():
        sys.exit(f"Dataset not found: {path}\nGenerate it first:  pnpm eval:export-ragas")

    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    dataset = Dataset.from_list(rows)
    print(f"✓ Ragas imported; loaded {len(rows)} rows from {path.name}.")

    if not (os.environ.get("OPENAI_API_KEY")):
        print("Set OPENAI_API_KEY (or an OpenAI-compatible endpoint via OPENAI_BASE_URL) to score.")
        return

    result = evaluate(dataset, metrics=[faithfulness, answer_relevancy, context_precision])
    print(result)


if __name__ == "__main__":
    main()
