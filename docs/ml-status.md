# ML Status

## Summary

`Chaos Chess` already has the pieces needed to become a real ML project, and it now includes an end-to-end baseline training path, even though it does not yet ship a production-ready learned engine inside the browser app.

What exists today:

- a custom rules environment with deterministic move legality
- a classic-engine path via Stockfish
- a custom variant search engine
- a flat feature encoder for board-state learning
- self-play data generation
- dataset export for supervised value learning
- zero-dependency baseline training and evaluation scripts
- a benchmark harness for quantitative comparisons

That means the repo already covers environment design, search-based data generation, feature encoding, baseline model training, offline evaluation, and hybrid-search experiments. The missing piece is a learned evaluator that is clearly useful in actual play.

## Current AI Stack

### 1. Runtime Engine Layer

Primary files:

- `src/classic-ai.js`
- `src/computer-engines.js`
- `src/app.js`

What it does:

- wraps Stockfish for classic chess
- exposes a shared runtime contract for computer opponents
- lets the browser app swap engines without changing board logic

Current backend families:

- `Stockfish`
  Classic chess only
- `Variant Search`
  Custom rule-aware search backend for the five Chaos Chess variants
- `Heuristic Baseline`
  Very weak but fast baseline useful for comparison and data-generation experiments

### 2. Custom Variant Search

Primary file:

- `src/computer-engines.js`

What exists today:

- promotion-aware move expansion
- handcrafted evaluation
- iterative deepening
- alpha-beta search
- transposition storage
- search deadline handling
- heuristic fallback if timed search does not complete

Important implementation details:

- search depth is currently chosen from branching factor and `Think Time`
- move ordering favors captures, promotions, castling, and wrap-around moves
- evaluation is rule-aware, so kamikaze and pawn-rule variants affect piece values
- search returns metadata such as `score`, `depth`, `nodes`, and `fallback`

This engine is still lightweight compared with a serious chess engine, but it is already a useful teacher for data generation.

### 3. Feature Encoder

Primary file:

- `src/position-encoder.js`

Current representation:

- 12 piece planes x 64 squares = `768`
- side to move = `1`
- castling rights = `4`
- en passant plane = `64`
- rule flags = `5`

Total vector length:

- `842`

Rule flags currently encoded:

- `friendly_fire`
- `kamikaze`
- `wrap_around`
- `double_direction_pawns`
- `jump_pawns`

Current encoding modes:

- `absolute`
  Standard white/black board orientation
- `canonical`
  Rotates black-to-move positions into the side-to-move perspective

This matters because canonical encoding removes unnecessary color-symmetry burden from the model and produced stronger offline results in later experiments.

### 4. Self-Play Dataset Generator

Primary files:

- `scripts/selfplay.js`
- `scripts/ai-common.js`

What it does:

- plays automated games between configurable bots
- supports classic, random, or explicit rule combinations
- writes JSONL samples for each ply
- writes metadata alongside the dataset

Current sample fields:

- `gameId`
- `ply`
- `engine`
- `turn`
- `rules`
- `legalMoveCount`
- `featureVector`
- `searchScore`
- `searchDepth`
- `searchNodes`
- `searchFallback`
- `move`
- `notation`
- `outcome`
- `finalStatus`
- `winner`

This is enough to train a first supervised value model.

### 5. Benchmark Harness

Primary files:

- `scripts/benchmark.js`
- `scripts/ai-common.js`

What it does:

- runs head-to-head matches between search, heuristic, and random bots
- supports configurable rulesets
- reports wins, draws, status counts, and average plies

This gives the project a quantitative backbone. It is the basis for future model-vs-search and model-vs-baseline comparisons.

### 6. Value Model Training

Primary files:

- `scripts/export-dataset.js`
- `scripts/train-value-model.py`
- `scripts/eval-value-model.py`
- `scripts/value_model.py`

What exists today:

- self-play JSONL can be converted into train/validation value datasets
- search scores are normalized into `[-1, 1]`
- outcome labels are blended into the training target
- the training path supports a `linear` model and an `mlp` model
- the evaluation path reports `MSE`, `RMSE`, `MAE`, `Pearson`, and non-draw outcome sign accuracy
- experiments can now test learned guidance both as leaf evaluation and as move ordering

Important implementation details:

- the current training scripts are dependency-free Python
- exported datasets retain ruleset identifiers so metrics can be broken down by rule combination
- the saved model format is JSON, which keeps the first checkpoint format inspectable and easy to version

This is intentionally a baseline ML layer, not the final model story. Its role is to prove the training and evaluation loop on top of the existing search system.

### 7. Shared-Model Strategy

The current direction is one shared model across all rule combinations, not one model per variant preset.

Why:

- there are `32` possible rule combinations from the five toggles
- the active rules are already encoded as model inputs
- a shared model is simpler to train, compare, and maintain
- it is a stronger generalization story than keeping one specialist model per ruleset

This means the current ML work is aimed at a conditional value model, not a bank of separate engines.

## Current Experiment Result

The current models are learning something real offline.

Evidence:

- canonical side-to-move encoding improved validation correlation
- deeper search teachers improved target quality
- linear and MLP baselines both fit the value targets meaningfully

But:

- the learned evaluators do not yet beat the handcrafted variant search reliably in gameplay benchmarks
- ordering-only guidance is promising as an idea, but not yet clearly stronger in practice

So the project is past the "toy ML scaffolding" stage, but not yet at the "model-backed engine is clearly better" stage.

## Tests And Verification

Relevant tests:

- `tests/computer-engines.test.js`
- `tests/position-encoder.test.js`
- `tests/engine.test.js`

What is covered today:

- rule semantics
- search behavior regressions
- heuristic/search differentiation on specific positions
- encoder vector length and feature placement

This matters for ML work because the training pipeline is only as trustworthy as the legality and encoding layers beneath it.

## Reproducible Commands

From the repo root:

```bash
make serve
make test
make check
make selfplay
make export-dataset
make train-value
make eval-value
make benchmark
```

Examples:

```bash
node scripts/selfplay.js --games 8 --rules random --white search --black search
node scripts/export-dataset.js --input ml/datasets/selfplay.jsonl
python3 scripts/train-value-model.py --model mlp --epochs 12
python3 scripts/eval-value-model.py --model ml/models/value-model.json
node scripts/benchmark.js --games 12 --rules friendlyFire,kamikaze --white search --black heuristic
```

## What Is Not Built Yet

Missing pieces:

- a committed production checkpoint
- model inference runtime inside the browser engine
- a learned evaluator that clearly improves play strength
- a stronger training stack for larger experiments, likely with a real ML framework

So the current state is:

- `yes` to ML-oriented infrastructure
- `yes` to baseline offline model training and evaluation
- `yes` to early hybrid-search experiments
- `not yet` to a clearly stronger live model-backed engine

## Why This Already Reads As An ML Project

The repo already demonstrates:

- custom environment design
- rule-aware search
- feature engineering
- self-play data generation
- training and evaluation loops
- experiment harnesses
- a clear path to learned inference inside a product
