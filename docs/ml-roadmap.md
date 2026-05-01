# ML Roadmap

## Goal

The target is not just "make the bot stronger."

The target is to show a full applied-ML stack:

- custom game environment
- search-based teacher
- reproducible data generation
- supervised learning
- model evaluation
- runtime inference in the playable browser app

## Current Stage

The repo is currently between these two stages:

1. `Baseline learned evaluators exist and benchmark cleanly offline`
2. `Learned guidance becomes clearly useful in actual play`

That is the right place to be. The next challenge is no longer "can we train a model?" It is "can the model improve the engine instead of just fitting labels?"

## Recommended Next Step

Use the current training path to build stronger teacher datasets and move to a more capable training stack, then integrate the best model in a way that actually improves search.

Why this is next:

- legality already exists
- search already exists
- the encoder already exists
- self-play already exists
- dataset export now exists
- baseline training and evaluation now exist
- hybrid-search experiments now exist

This should still be one shared model for all rule combinations, not one model per variant.

## Phase 1: Supervised Value Modeling

### Training Objective

Train a small model that predicts position strength from the 842-feature board encoding.

Recommended targets:

- normalized `searchScore`
- final game `outcome`

That can be done either as:

- a single scalar regression target
- or a multi-head model with score prediction plus outcome prediction

### Candidate Baselines

Train at least two baseline models:

1. `Gradient-boosted trees`
   Good for a quick non-neural baseline and useful for showing practical ML judgment.
2. `Small MLP`
   The cleanest first neural model for this feature format.

Suggested first neural shape:

```text
842 -> 256 -> 128 -> 1
```

This is intentionally modest. The goal is to prove the loop, not to overbuild the first model.

### What Already Exists

The repo now already includes:

- `scripts/export-dataset.js`
- `scripts/train-value-model.py`
- `scripts/eval-value-model.py`
- `ml/datasets/`
- `ml/models/`
- `ml/reports/`

## Phase 2: Offline Evaluation

The first trained model should be evaluated before it is ever wired into gameplay.

Track at least:

- validation loss
- correlation with search scores
- outcome prediction quality
- results split by ruleset
- performance on classic vs variant-heavy positions

This stage matters because a weak learned evaluator can easily make the search engine worse.

## Phase 3: Hybrid Search Plus ML

Once the model is decent offline, integrate it into the variant engine.

First integration options:

- replace the handcrafted leaf evaluation
- blend handcrafted score with model score
- use the model only for move ordering

Recommended order:

1. start with move ordering or blended evaluation
2. benchmark against handcrafted evaluation
3. only then consider full leaf replacement

## Phase 4: Product Integration

After offline and benchmark validation:

- add a model-backed variant engine behind the existing runtime contract
- keep the current search engine as the fallback baseline
- expose the hybrid engine in the browser UI
- document model strengths and limitations in the engine info modal

That keeps the repo playable while also showing end-to-end ML deployment.

## Phase 5: Stronger Experiments

Once the first learned value model is materially useful in gameplay, the next experiments become much more interesting.

Possible follow-ups:

- self-play loops that refresh the dataset from stronger engines
- policy plus value heads
- lightweight MCTS experiments
- search distillation into smaller fast models
- rule-specific ablation studies
- feature ablations for rule flags, en passant, or castling data

## What To Show Off

If the project is meant to signal ML breadth, the artifacts matter as much as the model.

We should produce:

- reproducible dataset generation commands
- experiment configs
- benchmark summaries
- validation reports
- model checkpoints
- notes on failures and tradeoffs

That makes the repo read like a real AI/ML engineering project instead of a vague "AI-enabled" demo.

## Immediate Build Order

The next concrete implementation order should be:

1. generate larger teacher datasets from deeper search
2. move training to a stronger stack such as PyTorch, ideally using Apple Silicon acceleration
3. compare teacher-data quality, target designs, and model sizes
4. improve hybrid integration through ordering and blended evaluation
5. benchmark on larger color-balanced match sets, not just tiny smoke comparisons
6. explore policy-style supervision or richer search targets if value-only parity persists
7. expose the model-backed engine in the browser UI only after it is credibly useful

That is the shortest path from today's codebase to a genuine hybrid ML engine.
