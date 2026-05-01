#!/usr/bin/env python3

import json
import math
import random
from typing import Dict, List, Optional


def parse_cli_args(argv: List[str]) -> Dict[str, str]:
    args: Dict[str, str] = {}
    index = 0

    while index < len(argv):
        token = argv[index]

        if not token.startswith("--"):
            index += 1
            continue

        key = token[2:]
        next_index = index + 1

        if next_index >= len(argv) or argv[next_index].startswith("--"):
            args[key] = "true"
            index += 1
            continue

        args[key] = argv[next_index]
        index += 2

    return args


def read_jsonl(path: str, limit: Optional[int] = None) -> List[Dict]:
    rows: List[Dict] = []

    with open(path, "r", encoding="utf8") as handle:
        for line in handle:
            stripped = line.strip()

            if not stripped:
                continue

            rows.append(json.loads(stripped))

            if limit is not None and len(rows) >= limit:
                break

    return rows


def load_value_dataset(path: str, limit: Optional[int] = None) -> List[Dict]:
    rows = read_jsonl(path, limit=limit)
    dataset: List[Dict] = []

    for row in rows:
        features = row.get("features")
        target = row.get("targetValue")

        if not isinstance(features, list) or target is None:
            continue

        dataset.append({
            "features": [float(value) for value in features],
            "target": float(target),
            "outcome": float(row.get("outcome", 0)),
            "rulesKey": row.get("rulesKey", "unknown"),
            "featureEncoding": row.get("featureEncoding", "absolute")
        })

    return dataset


def mean(values: List[float]) -> float:
    if not values:
        return 0.0

    return sum(values) / len(values)


def pearson_correlation(left: List[float], right: List[float]) -> float:
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


def sign(value: float) -> int:
    if value > 0:
        return 1

    if value < 0:
        return -1

    return 0


class LinearValueModel:
    model_type = "linear"

    def __init__(self, input_size: int, rng: random.Random):
        self.input_size = input_size
        self.weights = [rng.uniform(-0.01, 0.01) for _ in range(input_size)]
        self.bias = 0.0

    def predict(self, features: List[float]) -> float:
        total = self.bias

        for weight, feature in zip(self.weights, features):
            total += weight * feature

        return total

    def train_sample(self, features: List[float], target: float, learning_rate: float) -> float:
        prediction = self.predict(features)
        error = prediction - target

        for index, feature in enumerate(features):
            self.weights[index] -= learning_rate * error * feature

        self.bias -= learning_rate * error
        return 0.5 * error * error

    def snapshot(self) -> Dict:
        return {
            "weights": self.weights[:],
            "bias": self.bias
        }

    def restore(self, snapshot: Dict) -> None:
        self.weights = snapshot["weights"][:]
        self.bias = snapshot["bias"]

    def to_dict(self) -> Dict:
        return {
            "modelType": self.model_type,
            "inputSize": self.input_size,
            "weights": self.weights,
            "bias": self.bias
        }

    @classmethod
    def from_dict(cls, payload: Dict):
        instance = cls.__new__(cls)
        instance.input_size = payload["inputSize"]
        instance.weights = [float(value) for value in payload["weights"]]
        instance.bias = float(payload["bias"])
        return instance


class MLPValueModel:
    model_type = "mlp"

    def __init__(self, input_size: int, hidden_size: int, rng: random.Random):
        self.input_size = input_size
        self.hidden_size = hidden_size
        self.hidden_weights = [
            [rng.uniform(-0.04, 0.04) for _ in range(input_size)]
            for _ in range(hidden_size)
        ]
        self.hidden_biases = [0.0 for _ in range(hidden_size)]
        self.output_weights = [rng.uniform(-0.04, 0.04) for _ in range(hidden_size)]
        self.output_bias = 0.0

    def forward(self, features: List[float]):
        hidden_values: List[float] = []

        for row, bias in zip(self.hidden_weights, self.hidden_biases):
            total = bias

            for weight, feature in zip(row, features):
                total += weight * feature

            hidden_values.append(math.tanh(total))

        prediction = self.output_bias

        for weight, hidden_value in zip(self.output_weights, hidden_values):
            prediction += weight * hidden_value

        return prediction, hidden_values

    def predict(self, features: List[float]) -> float:
        prediction, _ = self.forward(features)
        return prediction

    def train_sample(self, features: List[float], target: float, learning_rate: float) -> float:
        prediction, hidden_values = self.forward(features)
        error = prediction - target
        output_weights_before = self.output_weights[:]

        for index, hidden_value in enumerate(hidden_values):
            self.output_weights[index] -= learning_rate * error * hidden_value

        self.output_bias -= learning_rate * error

        for hidden_index in range(self.hidden_size):
            delta = error * output_weights_before[hidden_index] * (1.0 - (hidden_values[hidden_index] ** 2))

            for input_index, feature in enumerate(features):
                self.hidden_weights[hidden_index][input_index] -= learning_rate * delta * feature

            self.hidden_biases[hidden_index] -= learning_rate * delta

        return 0.5 * error * error

    def snapshot(self) -> Dict:
        return {
            "hiddenWeights": [row[:] for row in self.hidden_weights],
            "hiddenBiases": self.hidden_biases[:],
            "outputWeights": self.output_weights[:],
            "outputBias": self.output_bias
        }

    def restore(self, snapshot: Dict) -> None:
        self.hidden_weights = [row[:] for row in snapshot["hiddenWeights"]]
        self.hidden_biases = snapshot["hiddenBiases"][:]
        self.output_weights = snapshot["outputWeights"][:]
        self.output_bias = snapshot["outputBias"]

    def to_dict(self) -> Dict:
        return {
            "modelType": self.model_type,
            "inputSize": self.input_size,
            "hiddenSize": self.hidden_size,
            "hiddenWeights": self.hidden_weights,
            "hiddenBiases": self.hidden_biases,
            "outputWeights": self.output_weights,
            "outputBias": self.output_bias
        }

    @classmethod
    def from_dict(cls, payload: Dict):
        instance = cls.__new__(cls)
        instance.input_size = payload["inputSize"]
        instance.hidden_size = payload["hiddenSize"]
        instance.hidden_weights = [
            [float(value) for value in row]
            for row in payload["hiddenWeights"]
        ]
        instance.hidden_biases = [float(value) for value in payload["hiddenBiases"]]
        instance.output_weights = [float(value) for value in payload["outputWeights"]]
        instance.output_bias = float(payload["outputBias"])
        return instance


def create_model(model_type: str, input_size: int, seed: int, hidden_size: int = 64):
    rng = random.Random(seed)

    if model_type == "linear":
        return LinearValueModel(input_size, rng)

    if model_type == "mlp":
        return MLPValueModel(input_size, hidden_size, rng)

    raise ValueError(f"Unsupported model type: {model_type}")


def load_model(path: str):
    with open(path, "r", encoding="utf8") as handle:
        payload = json.load(handle)

    model_payload = payload["model"]
    model_type = model_payload["modelType"]

    if model_type == "linear":
        return LinearValueModel.from_dict(model_payload), payload

    if model_type == "mlp":
        return MLPValueModel.from_dict(model_payload), payload

    raise ValueError(f"Unsupported model type: {model_type}")


def evaluate_model(model, samples: List[Dict]) -> Dict:
    predictions: List[float] = []
    targets: List[float] = []
    absolute_errors: List[float] = []
    squared_errors: List[float] = []
    outcome_correct = 0
    non_draw_outcomes = 0
    by_rules: Dict[str, Dict] = {}

    for sample in samples:
        prediction = model.predict(sample["features"])
        target = sample["target"]
        error = prediction - target
        rules_key = sample["rulesKey"]
        group = by_rules.get(rules_key, {
            "count": 0,
            "squaredError": 0.0,
            "absoluteError": 0.0
        })

        predictions.append(prediction)
        targets.append(target)
        absolute_errors.append(abs(error))
        squared_errors.append(error * error)
        group["count"] += 1
        group["squaredError"] += error * error
        group["absoluteError"] += abs(error)
        by_rules[rules_key] = group

        if sample["outcome"] != 0:
            non_draw_outcomes += 1

            if sign(prediction) == sign(sample["outcome"]):
                outcome_correct += 1

    rules_summary = {}

    for rules_key, group in by_rules.items():
        rules_summary[rules_key] = {
            "count": group["count"],
            "mse": group["squaredError"] / group["count"],
            "mae": group["absoluteError"] / group["count"]
        }

    mse = mean(squared_errors)
    return {
        "samples": len(samples),
        "mse": mse,
        "rmse": math.sqrt(mse) if mse > 0 else 0.0,
        "mae": mean(absolute_errors),
        "pearson": pearson_correlation(predictions, targets),
        "meanPrediction": mean(predictions),
        "meanTarget": mean(targets),
        "nonDrawOutcomeAccuracy": (outcome_correct / non_draw_outcomes) if non_draw_outcomes > 0 else 0.0,
        "byRules": rules_summary
    }


def train_epoch(model, samples: List[Dict], learning_rate: float, rng: random.Random) -> float:
    shuffled = samples[:]
    rng.shuffle(shuffled)
    total_loss = 0.0

    for sample in shuffled:
        total_loss += model.train_sample(sample["features"], sample["target"], learning_rate)

    return total_loss / len(shuffled) if shuffled else 0.0
