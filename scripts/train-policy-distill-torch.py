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

from value_model import parse_cli_args, read_jsonl


class LinearPolicyNet(nn.Module):
    def __init__(self, input_size: int):
        super().__init__()
        self.layer = nn.Linear(input_size, 1)

    def forward(self, inputs):
        return self.layer(inputs).squeeze(-1)


class MlpPolicyNet(nn.Module):
    def __init__(self, input_size: int, hidden_size: int):
        super().__init__()
        self.hidden = nn.Linear(input_size, hidden_size)
        self.output = nn.Linear(hidden_size, 1)

    def forward(self, inputs):
        hidden = torch.tanh(self.hidden(inputs))
        return self.output(hidden).squeeze(-1)


class DensePolicyNet(nn.Module):
    def __init__(self, input_size: int, hidden_sizes):
        super().__init__()
        layers = []
        layer_input_size = input_size

        for hidden_size in hidden_sizes:
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


def build_model(model_type: str, input_size: int, hidden_size: int, hidden_sizes):
    if model_type == "linear":
        return LinearPolicyNet(input_size)

    if model_type == "mlp":
        return MlpPolicyNet(input_size, hidden_size)

    if model_type == "dense":
        return DensePolicyNet(input_size, hidden_sizes)

    raise ValueError(f"Unsupported model type: {model_type}")


def export_model_payload(model, model_type, input_size, hidden_size, hidden_sizes):
    if model_type == "linear":
        return {
            "modelType": "linear",
            "inputSize": input_size,
            "weights": model.layer.weight.detach().cpu().squeeze(0).tolist(),
            "bias": float(model.layer.bias.detach().cpu().item())
        }

    if model_type == "mlp":
        return {
            "modelType": "mlp",
            "inputSize": input_size,
            "hiddenSize": hidden_size,
            "hiddenWeights": model.hidden.weight.detach().cpu().tolist(),
            "hiddenBiases": model.hidden.bias.detach().cpu().tolist(),
            "outputWeights": model.output.weight.detach().cpu().squeeze(0).tolist(),
            "outputBias": float(model.output.bias.detach().cpu().item())
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


def load_policy_candidates(path: str, limit=None):
    rows = read_jsonl(path, limit=limit)
    dataset = []

    for row in rows:
        features = row.get("features")
        target_probability = row.get("targetProbability")

        if not isinstance(features, list) or target_probability is None:
            continue

        dataset.append({
            "features": [float(value) for value in features],
            "targetProbability": float(target_probability),
            "targetScore": float(row.get("targetScore", 0)),
            "isTeacherBest": int(row.get("isTeacherBest", 0)),
            "positionId": row.get("positionId", "unknown"),
            "rulesKey": row.get("rulesKey", "unknown"),
            "featureEncoding": row.get("featureEncoding", "canonical"),
            "move": row.get("move", None)
        })

    return dataset


def group_policy_positions(samples):
    grouped = {}
    ordered_ids = []

    for sample in samples:
        position_id = sample["positionId"]

        if position_id not in grouped:
            grouped[position_id] = {
                "positionId": position_id,
                "rulesKey": sample.get("rulesKey", "unknown"),
                "featureEncoding": sample.get("featureEncoding", "canonical"),
                "candidates": [],
                "teacherBestIndex": None
            }
            ordered_ids.append(position_id)

        position = grouped[position_id]
        if sample["isTeacherBest"] == 1 and position["teacherBestIndex"] is None:
            position["teacherBestIndex"] = len(position["candidates"])

        position["candidates"].append({
            "features": sample["features"],
            "move": sample.get("move"),
            "targetProbability": sample["targetProbability"],
            "targetScore": sample.get("targetScore", 0.0)
        })

    positions = []

    for position_id in ordered_ids:
        position = grouped[position_id]

        if not position["candidates"]:
            continue

        positions.append(position)

    return positions


def chunked(items, batch_size):
    for index in range(0, len(items), batch_size):
        yield items[index:index + batch_size]


def make_position_batch(positions, device):
    input_size = len(positions[0]["candidates"][0]["features"])
    max_candidates = max(len(position["candidates"]) for position in positions)
    batch_size = len(positions)
    features = torch.zeros((batch_size, max_candidates, input_size), dtype=torch.float32, device=device)
    mask = torch.zeros((batch_size, max_candidates), dtype=torch.bool, device=device)
    target_probs = torch.zeros((batch_size, max_candidates), dtype=torch.float32, device=device)
    teacher_best = torch.zeros((batch_size,), dtype=torch.long, device=device)

    for position_index, position in enumerate(positions):
        teacher_best[position_index] = int(position["teacherBestIndex"] if position["teacherBestIndex"] is not None else 0)

        for candidate_index, candidate in enumerate(position["candidates"]):
            features[position_index, candidate_index] = torch.tensor(candidate["features"], dtype=torch.float32, device=device)
            mask[position_index, candidate_index] = True
            target_probs[position_index, candidate_index] = float(candidate["targetProbability"])

    target_sums = target_probs.sum(dim=1, keepdim=True)
    target_probs = torch.where(target_sums > 0, target_probs / target_sums, target_probs)
    return features, mask, target_probs, teacher_best


def mean(values):
    if not values:
        return 0.0

    return sum(values) / len(values)


def evaluate_model(model, positions, device, batch_size):
    model.eval()
    losses = []
    top1_correct = 0
    teacher_probabilities = []
    total_candidates = 0
    mae_probs = []

    with torch.no_grad():
        for position_batch in chunked(positions, batch_size):
            features, mask, target_probs, teacher_best = make_position_batch(position_batch, device)
            logits = model(features.view(-1, features.shape[-1])).view(features.shape[0], features.shape[1])
            logits = logits.masked_fill(~mask, -1e9)
            log_probs = torch.log_softmax(logits, dim=1)
            probabilities = torch.softmax(logits, dim=1)
            loss = -(target_probs * log_probs).sum(dim=1).mean()
            predictions = torch.argmax(logits, dim=1)

            losses.append(float(loss.detach().cpu().item()))
            top1_correct += int((predictions == teacher_best).sum().detach().cpu().item())
            teacher_probabilities.extend(
                probabilities[torch.arange(probabilities.shape[0], device=device), teacher_best].detach().cpu().tolist()
            )
            mae_probs.extend(torch.abs(probabilities - target_probs).sum(dim=1).detach().cpu().tolist())
            total_candidates += int(mask.sum().detach().cpu().item())

    return {
        "positions": len(positions),
        "candidates": total_candidates,
        "loss": mean(losses),
        "top1Accuracy": (top1_correct / len(positions)) if positions else 0.0,
        "meanTeacherProbability": mean(teacher_probabilities),
        "meanDistributionL1": mean(mae_probs),
        "averageCandidateCount": (total_candidates / len(positions)) if positions else 0.0
    }


def main():
    args = parse_cli_args(sys.argv[1:])
    train_path = os.path.abspath(args.get("train", "ml/datasets/policy-distill-train.jsonl"))
    validation_path = os.path.abspath(args.get("validation", "ml/datasets/policy-distill-validation.jsonl"))
    json_output_path = os.path.abspath(args.get("output", "ml/models/policy-distill-model-torch.json"))
    checkpoint_output_path = os.path.abspath(args.get("checkpoint-output", "ml/models/policy-distill-model-torch.pt"))
    report_output_path = os.path.abspath(args.get("report", "ml/reports/policy-distill-train-torch-report.json"))
    model_type = args.get("model", "mlp")
    hidden_size = int(args.get("hidden-size", "256"))
    hidden_sizes = parse_hidden_sizes(args.get("hidden-sizes", "256,128")) if model_type == "dense" else None
    epochs = int(args.get("epochs", "18"))
    batch_size = int(args.get("batch-size", "64"))
    learning_rate = float(args.get("learning-rate", "0.001"))
    weight_decay = float(args.get("weight-decay", "0.0001"))
    seed = int(args.get("seed", "1337"))
    device_name = args.get("device", "auto")
    limit = int(args["limit"]) if "limit" in args else None

    set_seed(seed)
    device = resolve_device(device_name)

    if hasattr(torch, "set_float32_matmul_precision"):
        torch.set_float32_matmul_precision("high")

    train_samples = load_policy_candidates(train_path, limit=limit)
    validation_samples = load_policy_candidates(validation_path, limit=limit)

    if not train_samples:
      raise ValueError("Training dataset is empty.")

    if not validation_samples:
        validation_samples = train_samples[:]

    train_positions = group_policy_positions(train_samples)
    validation_positions = group_policy_positions(validation_samples)

    if not train_positions:
        raise ValueError("Training positions are empty after grouping.")

    if not validation_positions:
        validation_positions = train_positions[:]

    input_size = len(train_positions[0]["candidates"][0]["features"])
    feature_encoding = train_positions[0].get("featureEncoding", "canonical")
    model = build_model(model_type, input_size, hidden_size, hidden_sizes).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    history = []
    best_validation_loss = None
    best_validation_top1 = None
    best_state = copy.deepcopy(model.state_dict())
    batch_rng = random.Random(seed)

    for epoch_index in range(epochs):
        model.train()
        epoch_positions = train_positions[:]
        batch_rng.shuffle(epoch_positions)
        batch_losses = []

        for position_batch in chunked(epoch_positions, batch_size):
            features, mask, target_probs, _teacher_best = make_position_batch(position_batch, device)
            logits = model(features.view(-1, features.shape[-1])).view(features.shape[0], features.shape[1])
            logits = logits.masked_fill(~mask, -1e9)
            log_probs = torch.log_softmax(logits, dim=1)
            loss = -(target_probs * log_probs).sum(dim=1).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            batch_losses.append(float(loss.detach().cpu().item()))

        train_metrics = evaluate_model(model, train_positions, device, batch_size)
        validation_metrics = evaluate_model(model, validation_positions, device, batch_size)
        history.append({
            "epoch": epoch_index + 1,
            "trainLoss": mean(batch_losses),
            "trainMetrics": train_metrics,
            "validationMetrics": validation_metrics
        })

        improved = False

        if best_validation_loss is None or validation_metrics["loss"] < best_validation_loss:
            improved = True
        elif (
            validation_metrics["loss"] == best_validation_loss and
            (best_validation_top1 is None or validation_metrics["top1Accuracy"] > best_validation_top1)
        ):
            improved = True

        if improved:
            best_validation_loss = validation_metrics["loss"]
            best_validation_top1 = validation_metrics["top1Accuracy"]
            best_state = copy.deepcopy(model.state_dict())

        sys.stdout.write(
            "Epoch {epoch}/{epochs} train_loss={train_loss:.6f} val_loss={val_loss:.6f} val_top1={val_top1:.4f} val_teacher_prob={val_teacher_prob:.4f}\n".format(
                epoch=epoch_index + 1,
                epochs=epochs,
                train_loss=mean(batch_losses),
                val_loss=validation_metrics["loss"],
                val_top1=validation_metrics["top1Accuracy"],
                val_teacher_prob=validation_metrics["meanTeacherProbability"]
            )
        )

    model.load_state_dict(best_state)
    final_train_metrics = evaluate_model(model, train_positions, device, batch_size)
    final_validation_metrics = evaluate_model(model, validation_positions, device, batch_size)
    payload = {
        "format": "chaos-chess-policy-distill-model-v1-torch",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trainingConfig": {
            "backend": "torch",
            "task": "policy_distillation",
            "objective": "softmax_cross_entropy",
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
        "Saved JSON model to {json_path}\nSaved checkpoint to {checkpoint_path}\nValidation top-1 accuracy: {top1:.4f}\nValidation teacher probability: {teacher_prob:.4f}\nResolved device: {device}\n".format(
            json_path=json_output_path,
            checkpoint_path=checkpoint_output_path,
            top1=final_validation_metrics["top1Accuracy"],
            teacher_prob=final_validation_metrics["meanTeacherProbability"],
            device=device
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
