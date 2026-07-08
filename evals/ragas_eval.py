#!/usr/bin/env python3
"""Score an Arbiter-exported dataset with Ragas.

Reads evals/ragas-dataset.jsonl (produced by `pnpm eval:export-ragas`) and scores
faithfulness / answer-relevancy / context-precision. Ragas uses a judge LLM +
embeddings, so set the provider env before running (e.g. OPENAI_API_KEY).

    pip install ragas datasets
    python evals/ragas_eval.py [path/to/dataset.jsonl]

This is the "real tool" companion to the native offline faithfulness proxy that
`pnpm eval:redteam` already computes from the guardrail grounding report.
"""
import json
import sys
from pathlib import Path

try:
    from datasets import Dataset
    from ragas import evaluate
    from ragas.metrics import answer_relevancy, context_precision, faithfulness
except ImportError:
    sys.exit("Missing deps. Install with:  pip install ragas datasets")


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "ragas-dataset.jsonl"
    if not path.exists():
        sys.exit(f"Dataset not found: {path}\nGenerate it first:  pnpm eval:export-ragas")

    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    dataset = Dataset.from_list(rows)

    result = evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy, context_precision],
    )
    print(result)


if __name__ == "__main__":
    main()
