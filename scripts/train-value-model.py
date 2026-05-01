#!/usr/bin/env python3

import json
import os
import random
import sys
from datetime import datetime, timezone

from value_model import (
    create_model,
    evaluate_model,
    load_value_dataset,
    parse_cli_args,
    train_epoch,
)


def ensure_parent_dir(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)


def main() -> int:
    args = parse_cli_args(sys.argv[1:])
    train_path = os.path.abspath(args.get("train", "ml/datasets/value-train.jsonl"))
    validation_path = os.path.abspath(args.get("validation", "ml/datasets/value-validation.jsonl"))
    model_output_path = os.path.abspath(args.get("output", "ml/models/value-model.json"))
    report_output_path = os.path.abspath(args.get("report", "ml/reports/value-train-report.json"))
    model_type = args.get("model", "mlp")
    hidden_size = int(args.get("hidden-size", "64"))
    epochs = int(args.get("epochs", "12"))
    learning_rate = float(args.get("learning-rate", "0.01"))
    seed = int(args.get("seed", "1337"))
    limit = int(args["limit"]) if "limit" in args else None

    train_samples = load_value_dataset(train_path, limit=limit)
    validation_samples = load_value_dataset(validation_path, limit=limit)

    if not train_samples:
        raise ValueError("Training dataset is empty.")

    if not validation_samples:
        validation_samples = train_samples[:]

    input_size = len(train_samples[0]["features"])
    feature_encoding = train_samples[0].get("featureEncoding", "absolute")
    model = create_model(model_type, input_size, seed=seed, hidden_size=hidden_size)
    rng = random.Random(seed)
    history = []
    best_snapshot = model.snapshot()
    best_validation_mse = None

    for epoch_index in range(epochs):
        train_loss = train_epoch(model, train_samples, learning_rate, rng)
        train_metrics = evaluate_model(model, train_samples)
        validation_metrics = evaluate_model(model, validation_samples)
        history.append({
            "epoch": epoch_index + 1,
            "trainLoss": train_loss,
            "trainMetrics": train_metrics,
            "validationMetrics": validation_metrics
        })

        if best_validation_mse is None or validation_metrics["mse"] < best_validation_mse:
            best_validation_mse = validation_metrics["mse"]
            best_snapshot = model.snapshot()

        sys.stdout.write(
            "Epoch {epoch}/{epochs} train_loss={train_loss:.6f} val_mse={val_mse:.6f} val_corr={val_corr:.4f}\n".format(
                epoch=epoch_index + 1,
                epochs=epochs,
                train_loss=train_loss,
                val_mse=validation_metrics["mse"],
                val_corr=validation_metrics["pearson"]
            )
        )

    model.restore(best_snapshot)
    final_train_metrics = evaluate_model(model, train_samples)
    final_validation_metrics = evaluate_model(model, validation_samples)
    payload = {
        "format": "chaos-chess-value-model-v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trainingConfig": {
            "modelType": model_type,
            "hiddenSize": hidden_size if model_type == "mlp" else None,
            "epochs": epochs,
            "learningRate": learning_rate,
            "seed": seed,
            "featureEncoding": feature_encoding,
            "trainPath": train_path,
            "validationPath": validation_path,
            "limit": limit
        },
        "model": model.to_dict(),
        "metrics": {
            "train": final_train_metrics,
            "validation": final_validation_metrics
        },
        "history": history
    }

    ensure_parent_dir(model_output_path)
    ensure_parent_dir(report_output_path)

    with open(model_output_path, "w", encoding="utf8") as handle:
        json.dump(payload, handle, indent=2)

    with open(report_output_path, "w", encoding="utf8") as handle:
        json.dump({
            "generatedAt": payload["generatedAt"],
            "trainingConfig": payload["trainingConfig"],
            "metrics": payload["metrics"],
            "history": payload["history"]
        }, handle, indent=2)

    sys.stdout.write(
        "Saved model to {model_path}\nValidation RMSE: {rmse:.6f}\nValidation correlation: {corr:.4f}\n".format(
            model_path=model_output_path,
            rmse=final_validation_metrics["rmse"],
            corr=final_validation_metrics["pearson"]
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
