#!/usr/bin/env python3

import copy
import json
import math
import os
import random
import sys
from datetime import datetime, timezone

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from value_model import load_value_dataset, parse_cli_args


class LinearValueNet(nn.Module):
    def __init__(self, input_size: int):
        super().__init__()
        self.layer = nn.Linear(input_size, 1)

    def forward(self, inputs):
        return self.layer(inputs).squeeze(-1)


class MlpValueNet(nn.Module):
    def __init__(self, input_size: int, hidden_size: int):
        super().__init__()
        self.hidden = nn.Linear(input_size, hidden_size)
        self.output = nn.Linear(hidden_size, 1)

    def forward(self, inputs):
        hidden = torch.tanh(self.hidden(inputs))
        return self.output(hidden).squeeze(-1)


class DenseValueNet(nn.Module):
    def __init__(self, input_size: int, hidden_sizes):
        super().__init__()
        self.hidden_sizes = list(hidden_sizes)
        layers = []
        layer_input_size = input_size

        for hidden_size in self.hidden_sizes:
            layers.append(nn.Linear(layer_input_size, hidden_size))
            layer_input_size = hidden_size

        self.hidden_layers = nn.ModuleList(layers)
        self.output = nn.Linear(layer_input_size, 1)

    def forward(self, inputs):
        activations = inputs

        for layer in self.hidden_layers:
            activations = torch.tanh(layer(activations))

        return self.output(activations).squeeze(-1)


def ensure_parent_dir(path: str) -> None:
    directory = os.path.dirname(path)

    if directory:
        os.makedirs(directory, exist_ok=True)


def resolve_device(requested: str) -> torch.device:
    normalized = (requested or "auto").lower()

    if normalized == "auto":
        if torch.backends.mps.is_available():
            return torch.device("mps")

        if torch.cuda.is_available():
            return torch.device("cuda")

        return torch.device("cpu")

    if normalized == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("MPS was requested, but torch.backends.mps.is_available() is false.")

        return torch.device("mps")

    if normalized == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA was requested, but torch.cuda.is_available() is false.")

        return torch.device("cuda")

    if normalized == "cpu":
        return torch.device("cpu")

    raise ValueError(f"Unsupported device: {requested}")


def set_seed(seed: int) -> None:
    random.seed(seed)
    torch.manual_seed(seed)


def build_model(model_type: str, input_size: int, hidden_size: int) -> nn.Module:
    if model_type == "linear":
        return LinearValueNet(input_size)

    if model_type == "mlp":
        return MlpValueNet(input_size, hidden_size)

    if model_type == "dense":
        raise ValueError("Dense models require hidden-sizes and build_model_from_args.")

    raise ValueError(f"Unsupported model type: {model_type}")


def parse_hidden_sizes(raw_value: str):
    values = []

    for token in (raw_value or "").split(","):
        stripped = token.strip()

        if not stripped:
            continue

        value = int(stripped)

        if value <= 0:
            raise ValueError("hidden-sizes values must be positive integers.")

        values.append(value)

    if not values:
        raise ValueError("hidden-sizes must include at least one positive integer.")

    return values


def build_model_from_args(model_type: str, input_size: int, hidden_size: int, hidden_sizes):
    if model_type == "dense":
        return DenseValueNet(input_size, hidden_sizes)

    return build_model(model_type, input_size, hidden_size)


def create_tensor_dataset(samples):
    features = torch.tensor([sample["features"] for sample in samples], dtype=torch.float32)
    targets = torch.tensor([sample["target"] for sample in samples], dtype=torch.float32)
    outcomes = torch.tensor([sample["outcome"] for sample in samples], dtype=torch.float32)
    return TensorDataset(features, targets, outcomes)


def mean(values):
    if not values:
        return 0.0

    return sum(values) / len(values)


def pearson_correlation(left, right):
    if not left or not right or len(left) != len(right):
        return 0.0

    left_mean = mean(left)
    right_mean = mean(right)
    numerator = 0.0
    left_variance = 0.0
    right_variance = 0.0

    for left_value, right_value in zip(left, right):
        left_delta = left_value - left_mean
        right_delta = right_value - right_mean
        numerator += left_delta * right_delta
        left_variance += left_delta * left_delta
        right_variance += right_delta * right_delta

    if left_variance <= 0 or right_variance <= 0:
        return 0.0

    return numerator / math.sqrt(left_variance * right_variance)


def sign(value):
    if value > 0:
        return 1

    if value < 0:
        return -1

    return 0


def evaluate_model(model, dataset, device, batch_size):
    model.eval()
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False)
    predictions = []
    targets = []
    outcomes = []
    squared_errors = []
    absolute_errors = []
    outcome_correct = 0
    non_draw_outcomes = 0

    with torch.no_grad():
        for features, target_values, outcome_values in loader:
            features = features.to(device)
            target_values = target_values.to(device)
            predictions_batch = model(features)
            errors = predictions_batch - target_values

            predictions.extend(predictions_batch.detach().cpu().tolist())
            targets.extend(target_values.detach().cpu().tolist())
            outcomes.extend(outcome_values.tolist())
            squared_errors.extend((errors.detach().cpu() ** 2).tolist())
            absolute_errors.extend(errors.detach().cpu().abs().tolist())

    for prediction, outcome in zip(predictions, outcomes):
        if outcome != 0:
            non_draw_outcomes += 1

            if sign(prediction) == sign(outcome):
                outcome_correct += 1

    mse = mean(squared_errors)
    return {
        "samples": len(predictions),
        "mse": mse,
        "rmse": math.sqrt(mse) if mse > 0 else 0.0,
        "mae": mean(absolute_errors),
        "pearson": pearson_correlation(predictions, targets),
        "meanPrediction": mean(predictions),
        "meanTarget": mean(targets),
        "nonDrawOutcomeAccuracy": (outcome_correct / non_draw_outcomes) if non_draw_outcomes > 0 else 0.0
    }


def export_model_payload(model, model_type, input_size, hidden_size, hidden_sizes):
    if model_type == "linear":
        weights = model.layer.weight.detach().cpu().squeeze(0).tolist()
        bias = float(model.layer.bias.detach().cpu().item())
        return {
            "modelType": "linear",
            "inputSize": input_size,
            "weights": weights,
            "bias": bias
        }

    if model_type == "mlp":
        hidden_weights = model.hidden.weight.detach().cpu().tolist()
        hidden_biases = model.hidden.bias.detach().cpu().tolist()
        output_weights = model.output.weight.detach().cpu().squeeze(0).tolist()
        output_bias = float(model.output.bias.detach().cpu().item())
        return {
            "modelType": "mlp",
            "inputSize": input_size,
            "hiddenSize": hidden_size,
            "hiddenWeights": hidden_weights,
            "hiddenBiases": hidden_biases,
            "outputWeights": output_weights,
            "outputBias": output_bias
        }

    if model_type == "dense":
        return {
            "modelType": "dense",
            "inputSize": input_size,
            "hiddenSizes": hidden_sizes,
            "layerWeights": [layer.weight.detach().cpu().tolist() for layer in model.hidden_layers],
            "layerBiases": [layer.bias.detach().cpu().tolist() for layer in model.hidden_layers],
            "outputWeights": model.output.weight.detach().cpu().squeeze(0).tolist(),
            "outputBias": float(model.output.bias.detach().cpu().item())
        }

    raise ValueError(f"Unsupported model type: {model_type}")


def main():
    args = parse_cli_args(sys.argv[1:])
    train_path = os.path.abspath(args.get("train", "ml/datasets/value-train.jsonl"))
    validation_path = os.path.abspath(args.get("validation", "ml/datasets/value-validation.jsonl"))
    json_output_path = os.path.abspath(args.get("output", "ml/models/value-model-torch.json"))
    checkpoint_output_path = os.path.abspath(args.get("checkpoint-output", "ml/models/value-model-torch.pt"))
    report_output_path = os.path.abspath(args.get("report", "ml/reports/value-train-torch-report.json"))
    model_type = args.get("model", "mlp")
    hidden_size = int(args.get("hidden-size", "64"))
    hidden_sizes = parse_hidden_sizes(args.get("hidden-sizes", "128,64")) if model_type == "dense" else None
    epochs = int(args.get("epochs", "24"))
    batch_size = int(args.get("batch-size", "128"))
    learning_rate = float(args.get("learning-rate", "0.001"))
    weight_decay = float(args.get("weight-decay", "0.0001"))
    seed = int(args.get("seed", "1337"))
    device_name = args.get("device", "auto")
    limit = int(args["limit"]) if "limit" in args else None

    set_seed(seed)
    device = resolve_device(device_name)

    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("high")

    train_samples = load_value_dataset(train_path, limit=limit)
    validation_samples = load_value_dataset(validation_path, limit=limit)

    if not train_samples:
        raise ValueError("Training dataset is empty.")

    if not validation_samples:
        validation_samples = train_samples[:]

    input_size = len(train_samples[0]["features"])
    feature_encoding = train_samples[0].get("featureEncoding", "absolute")
    train_dataset = create_tensor_dataset(train_samples)
    validation_dataset = create_tensor_dataset(validation_samples)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    model = build_model_from_args(model_type, input_size, hidden_size, hidden_sizes).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    loss_fn = nn.MSELoss()
    history = []
    best_validation_mse = None
    best_state = copy.deepcopy(model.state_dict())

    for epoch_index in range(epochs):
        model.train()
        batch_losses = []

        for features, target_values, _ in train_loader:
            features = features.to(device)
            target_values = target_values.to(device)
            optimizer.zero_grad(set_to_none=True)
            predictions = model(features)
            loss = loss_fn(predictions, target_values)
            loss.backward()
            optimizer.step()
            batch_losses.append(float(loss.detach().cpu().item()))

        train_metrics = evaluate_model(model, train_dataset, device, batch_size)
        validation_metrics = evaluate_model(model, validation_dataset, device, batch_size)
        history.append({
            "epoch": epoch_index + 1,
            "trainLoss": mean(batch_losses),
            "trainMetrics": train_metrics,
            "validationMetrics": validation_metrics
        })

        if best_validation_mse is None or validation_metrics["mse"] < best_validation_mse:
            best_validation_mse = validation_metrics["mse"]
            best_state = copy.deepcopy(model.state_dict())

        sys.stdout.write(
            "Epoch {epoch}/{epochs} train_loss={train_loss:.6f} val_mse={val_mse:.6f} val_corr={val_corr:.4f}\n".format(
                epoch=epoch_index + 1,
                epochs=epochs,
                train_loss=mean(batch_losses),
                val_mse=validation_metrics["mse"],
                val_corr=validation_metrics["pearson"]
            )
        )

    model.load_state_dict(best_state)
    final_train_metrics = evaluate_model(model, train_dataset, device, batch_size)
    final_validation_metrics = evaluate_model(model, validation_dataset, device, batch_size)
    payload = {
        "format": "chaos-chess-value-model-v2-torch",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trainingConfig": {
            "backend": "torch",
            "modelType": model_type,
            "hiddenSize": hidden_size if model_type == "mlp" else None,
            "hiddenSizes": hidden_sizes if model_type == "dense" else None,
            "epochs": epochs,
            "batchSize": batch_size,
            "learningRate": learning_rate,
            "weightDecay": weight_decay,
            "seed": seed,
            "deviceRequested": device_name,
            "deviceResolved": str(device),
            "featureEncoding": feature_encoding,
            "trainPath": train_path,
            "validationPath": validation_path,
            "limit": limit
        },
        "model": export_model_payload(model, model_type, input_size, hidden_size, hidden_sizes),
        "metrics": {
            "train": final_train_metrics,
            "validation": final_validation_metrics
        },
        "history": history
    }

    ensure_parent_dir(json_output_path)
    ensure_parent_dir(checkpoint_output_path)
    ensure_parent_dir(report_output_path)

    with open(json_output_path, "w", encoding="utf8") as handle:
        json.dump(payload, handle, indent=2)

    torch.save({
        "format": payload["format"],
        "generatedAt": payload["generatedAt"],
        "trainingConfig": payload["trainingConfig"],
        "modelState": model.state_dict()
    }, checkpoint_output_path)

    with open(report_output_path, "w", encoding="utf8") as handle:
        json.dump({
            "generatedAt": payload["generatedAt"],
            "trainingConfig": payload["trainingConfig"],
            "metrics": payload["metrics"],
            "history": payload["history"]
        }, handle, indent=2)

    sys.stdout.write(
        "Saved JSON model to {json_path}\nSaved checkpoint to {checkpoint_path}\nValidation RMSE: {rmse:.6f}\nValidation correlation: {corr:.4f}\nResolved device: {device}\n".format(
            json_path=json_output_path,
            checkpoint_path=checkpoint_output_path,
            rmse=final_validation_metrics["rmse"],
            corr=final_validation_metrics["pearson"],
            device=device
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
