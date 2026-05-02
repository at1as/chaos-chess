#!/usr/bin/env python3

import copy
import json
import os
import random
import sys
from datetime import datetime, timezone

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

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


def mean(values):
    if not values:
        return 0.0

    return sum(values) / len(values)


def load_pairwise_samples(path: str, limit=None):
    rows = read_jsonl(path, limit=limit)
    dataset = []

    for row in rows:
        better_features = row.get("betterFeatures")
        worse_features = row.get("worseFeatures")
        pair_weight = row.get("pairWeight")

        if not isinstance(better_features, list) or not isinstance(worse_features, list):
            continue

        dataset.append({
            "betterFeatures": [float(value) for value in better_features],
            "worseFeatures": [float(value) for value in worse_features],
            "pairWeight": float(pair_weight if pair_weight is not None else 1.0),
            "rulesKey": row.get("rulesKey", "unknown"),
            "featureEncoding": row.get("featureEncoding", "canonical"),
            "positionId": row.get("positionId", "unknown")
        })

    return dataset


def create_pairwise_dataset(samples):
    better = torch.tensor([sample["betterFeatures"] for sample in samples], dtype=torch.float32)
    worse = torch.tensor([sample["worseFeatures"] for sample in samples], dtype=torch.float32)
    weights = torch.tensor([sample["pairWeight"] for sample in samples], dtype=torch.float32)
    return TensorDataset(better, worse, weights)


def load_candidate_rows(path: str, limit=None):
    rows = read_jsonl(path, limit=limit)
    dataset = []

    for row in rows:
        features = row.get("features")

        if not isinstance(features, list):
            continue

        dataset.append({
            "features": [float(value) for value in features],
            "targetProbability": float(row.get("targetProbability", 0.0)),
            "targetScore": float(row.get("targetScore", 0.0)),
            "isTeacherBest": int(row.get("isTeacherBest", 0)),
            "positionId": row.get("positionId", "unknown"),
            "rulesKey": row.get("rulesKey", "unknown"),
            "featureEncoding": row.get("featureEncoding", "canonical"),
            "move": row.get("move", None)
        })

    return dataset


def group_candidate_positions(samples):
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
            "targetScore": sample["targetScore"]
        })

    positions = []

    for position_id in ordered_ids:
        position = grouped[position_id]

        if position["teacherBestIndex"] is None or not position["candidates"]:
            continue

        positions.append(position)

    return positions


def chunked(items, batch_size):
    for index in range(0, len(items), batch_size):
        yield items[index:index + batch_size]


def make_candidate_batch(positions, device):
    input_size = len(positions[0]["candidates"][0]["features"])
    max_candidates = max(len(position["candidates"]) for position in positions)
    batch_size = len(positions)
    features = torch.zeros((batch_size, max_candidates, input_size), dtype=torch.float32, device=device)
    mask = torch.zeros((batch_size, max_candidates), dtype=torch.bool, device=device)
    target_probs = torch.zeros((batch_size, max_candidates), dtype=torch.float32, device=device)
    teacher_best = torch.zeros((batch_size,), dtype=torch.long, device=device)

    for position_index, position in enumerate(positions):
        teacher_best[position_index] = int(position["teacherBestIndex"])

        for candidate_index, candidate in enumerate(position["candidates"]):
            features[position_index, candidate_index] = torch.tensor(candidate["features"], dtype=torch.float32, device=device)
            mask[position_index, candidate_index] = True
            target_probs[position_index, candidate_index] = float(candidate["targetProbability"])

    target_sums = target_probs.sum(dim=1, keepdim=True)
    target_probs = torch.where(target_sums > 0, target_probs / target_sums, target_probs)
    return features, mask, target_probs, teacher_best


def evaluate_pairwise(model, dataset, device, batch_size):
    model.eval()
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=False)
    losses = []
    correct = 0
    total = 0
    margins = []

    with torch.no_grad():
        for better_features, worse_features, weights in loader:
            better_features = better_features.to(device)
            worse_features = worse_features.to(device)
            weights = weights.to(device)
            better_scores = model(better_features)
            worse_scores = model(worse_features)
            score_deltas = better_scores - worse_scores
            loss = (torch.nn.functional.softplus(-score_deltas) * weights).mean()

            losses.append(float(loss.detach().cpu().item()))
            correct += int((score_deltas > 0).sum().detach().cpu().item())
            total += int(score_deltas.shape[0])
            margins.extend(score_deltas.detach().cpu().tolist())

    return {
        "pairs": total,
        "loss": mean(losses),
        "pairAccuracy": (correct / total) if total > 0 else 0.0,
        "meanMargin": mean(margins)
    }


def evaluate_candidate_positions(model, positions, device, batch_size):
    model.eval()
    top1_correct = 0
    teacher_probabilities = []
    mean_distribution_l1 = []
    total_candidates = 0

    with torch.no_grad():
        for position_batch in chunked(positions, batch_size):
            features, mask, target_probs, teacher_best = make_candidate_batch(position_batch, device)
            logits = model(features.view(-1, features.shape[-1])).view(features.shape[0], features.shape[1])
            logits = logits.masked_fill(~mask, -1e9)
            probabilities = torch.softmax(logits, dim=1)
            predictions = torch.argmax(logits, dim=1)

            top1_correct += int((predictions == teacher_best).sum().detach().cpu().item())
            teacher_probabilities.extend(
                probabilities[torch.arange(probabilities.shape[0], device=device), teacher_best].detach().cpu().tolist()
            )
            mean_distribution_l1.extend(torch.abs(probabilities - target_probs).sum(dim=1).detach().cpu().tolist())
            total_candidates += int(mask.sum().detach().cpu().item())

    return {
        "positions": len(positions),
        "candidates": total_candidates,
        "top1Accuracy": (top1_correct / len(positions)) if positions else 0.0,
        "meanTeacherProbability": mean(teacher_probabilities),
        "meanDistributionL1": mean(mean_distribution_l1),
        "averageCandidateCount": (total_candidates / len(positions)) if positions else 0.0
    }


def main():
    args = parse_cli_args(sys.argv[1:])
    train_path = os.path.abspath(args.get("train", "ml/datasets/pairwise-policy-train.jsonl"))
    validation_path = os.path.abspath(args.get("validation", "ml/datasets/pairwise-policy-validation.jsonl"))
    eval_train_candidates_path = os.path.abspath(args.get("eval-train-candidates")) if args.get("eval-train-candidates") else None
    eval_validation_candidates_path = os.path.abspath(args.get("eval-validation-candidates")) if args.get("eval-validation-candidates") else None
    json_output_path = os.path.abspath(args.get("output", "ml/models/pairwise-policy-model-torch.json"))
    checkpoint_output_path = os.path.abspath(args.get("checkpoint-output", "ml/models/pairwise-policy-model-torch.pt"))
    report_output_path = os.path.abspath(args.get("report", "ml/reports/pairwise-policy-train-torch-report.json"))
    model_type = args.get("model", "mlp")
    hidden_size = int(args.get("hidden-size", "256"))
    hidden_sizes = parse_hidden_sizes(args.get("hidden-sizes", "256,128")) if model_type == "dense" else None
    epochs = int(args.get("epochs", "18"))
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

    train_samples = load_pairwise_samples(train_path, limit=limit)
    validation_samples = load_pairwise_samples(validation_path, limit=limit)

    if not train_samples:
        raise ValueError("Training pairwise dataset is empty.")

    if not validation_samples:
        validation_samples = train_samples[:]

    train_dataset = create_pairwise_dataset(train_samples)
    validation_dataset = create_pairwise_dataset(validation_samples)
    input_size = len(train_samples[0]["betterFeatures"])
    feature_encoding = train_samples[0].get("featureEncoding", "canonical")
    model = build_model(model_type, input_size, hidden_size, hidden_sizes).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=weight_decay)
    train_loader = DataLoader(train_dataset, batch_size=batch_size, shuffle=True)
    history = []
    best_validation_loss = None
    best_validation_accuracy = None
    best_state = copy.deepcopy(model.state_dict())
    eval_train_positions = None
    eval_validation_positions = None

    if eval_train_candidates_path:
        eval_train_positions = group_candidate_positions(load_candidate_rows(eval_train_candidates_path, limit=limit))

    if eval_validation_candidates_path:
        eval_validation_positions = group_candidate_positions(load_candidate_rows(eval_validation_candidates_path, limit=limit))

    if eval_train_positions and not eval_validation_positions:
        eval_validation_positions = eval_train_positions[:]

    for epoch_index in range(epochs):
        model.train()
        batch_losses = []

        for better_features, worse_features, weights in train_loader:
            better_features = better_features.to(device)
            worse_features = worse_features.to(device)
            weights = weights.to(device)
            better_scores = model(better_features)
            worse_scores = model(worse_features)
            score_deltas = better_scores - worse_scores
            loss = (torch.nn.functional.softplus(-score_deltas) * weights).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            batch_losses.append(float(loss.detach().cpu().item()))

        train_metrics = evaluate_pairwise(model, train_dataset, device, batch_size)
        validation_metrics = evaluate_pairwise(model, validation_dataset, device, batch_size)
        train_candidate_metrics = evaluate_candidate_positions(model, eval_train_positions, device, batch_size) if eval_train_positions else None
        validation_candidate_metrics = evaluate_candidate_positions(model, eval_validation_positions, device, batch_size) if eval_validation_positions else None

        history.append({
            "epoch": epoch_index + 1,
            "trainLoss": mean(batch_losses),
            "trainPairMetrics": train_metrics,
            "validationPairMetrics": validation_metrics,
            "trainCandidateMetrics": train_candidate_metrics,
            "validationCandidateMetrics": validation_candidate_metrics
        })

        improved = False

        if best_validation_loss is None or validation_metrics["loss"] < best_validation_loss:
            improved = True
        elif (
            validation_metrics["loss"] == best_validation_loss and
            (best_validation_accuracy is None or validation_metrics["pairAccuracy"] > best_validation_accuracy)
        ):
            improved = True

        if improved:
            best_validation_loss = validation_metrics["loss"]
            best_validation_accuracy = validation_metrics["pairAccuracy"]
            best_state = copy.deepcopy(model.state_dict())

        sys.stdout.write(
            "Epoch {epoch}/{epochs} train_loss={train_loss:.6f} val_loss={val_loss:.6f} val_pair_acc={val_pair_acc:.4f}{val_top1}\n".format(
                epoch=epoch_index + 1,
                epochs=epochs,
                train_loss=mean(batch_losses),
                val_loss=validation_metrics["loss"],
                val_pair_acc=validation_metrics["pairAccuracy"],
                val_top1=(
                    " val_top1={:.4f}".format(validation_candidate_metrics["top1Accuracy"])
                    if validation_candidate_metrics else ""
                )
            )
        )

    model.load_state_dict(best_state)
    final_train_pair_metrics = evaluate_pairwise(model, train_dataset, device, batch_size)
    final_validation_pair_metrics = evaluate_pairwise(model, validation_dataset, device, batch_size)
    final_train_candidate_metrics = evaluate_candidate_positions(model, eval_train_positions, device, batch_size) if eval_train_positions else None
    final_validation_candidate_metrics = evaluate_candidate_positions(model, eval_validation_positions, device, batch_size) if eval_validation_positions else None
    payload = {
        "format": "chaos-chess-policy-pairwise-model-v1-torch",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "trainingConfig": {
            "backend": "torch",
            "task": "policy_pairwise_ranking",
            "objective": "weighted_logistic_pairwise",
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
            "evalTrainCandidatesPath": eval_train_candidates_path,
            "evalValidationCandidatesPath": eval_validation_candidates_path,
            "limit": limit
        },
        "model": export_model_payload(model, model_type, input_size, hidden_size, hidden_sizes),
        "metrics": {
            "trainPairwise": final_train_pair_metrics,
            "validationPairwise": final_validation_pair_metrics,
            "trainCandidates": final_train_candidate_metrics,
            "validationCandidates": final_validation_candidate_metrics
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
        "Saved JSON model to {json_path}\nSaved checkpoint to {checkpoint_path}\nValidation pair accuracy: {pair_acc:.4f}{top1}\nResolved device: {device}\n".format(
            json_path=json_output_path,
            checkpoint_path=checkpoint_output_path,
            pair_acc=final_validation_pair_metrics["pairAccuracy"],
            top1=(
                "\nValidation top-1 accuracy: {:.4f}".format(final_validation_candidate_metrics["top1Accuracy"])
                if final_validation_candidate_metrics else ""
            ),
            device=device
        )
    )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
