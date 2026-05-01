#!/usr/bin/env python3

import json
import os
import sys
from datetime import datetime, timezone

from value_model import evaluate_model, load_model, load_value_dataset, parse_cli_args


def ensure_parent_dir(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def main() -> int:
    args = parse_cli_args(sys.argv[1:])
    dataset_path = os.path.abspath(args.get("dataset", "ml/datasets/value-validation.jsonl"))
    model_path = os.path.abspath(args.get("model", "ml/models/value-model.json"))
    output_path = os.path.abspath(args.get("output", "ml/reports/value-eval-report.json"))
    limit = int(args["limit"]) if "limit" in args else None
    model, payload = load_model(model_path)
    samples = load_value_dataset(dataset_path, limit=limit)

    if not samples:
        raise ValueError("Evaluation dataset is empty.")

    metrics = evaluate_model(model, samples)
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "datasetPath": dataset_path,
        "modelPath": model_path,
        "modelType": payload["model"]["modelType"],
        "metrics": metrics
    }

    ensure_parent_dir(output_path)

    with open(output_path, "w", encoding="utf8") as handle:
        json.dump(report, handle, indent=2)

    sys.stdout.write(
        "Evaluated {model_type} model on {samples} samples\nMSE: {mse:.6f}\nRMSE: {rmse:.6f}\nMAE: {mae:.6f}\nPearson: {pearson:.4f}\nOutcome sign accuracy: {accuracy:.4f}\nSaved report to {output_path}\n".format(
            model_type=payload["model"]["modelType"],
            samples=metrics["samples"],
            mse=metrics["mse"],
            rmse=metrics["rmse"],
            mae=metrics["mae"],
            pearson=metrics["pearson"],
            accuracy=metrics["nonDrawOutcomeAccuracy"],
            output_path=output_path
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
