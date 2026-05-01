# ML Status

## Summary

`Chaos Chess` already has the pieces needed to become a real ML project, and it now includes an end-to-end training path plus a curated ML-backed variant engine exposed in the browser app.

What exists today:

- a custom rules environment with deterministic move legality
- a classic-engine path via Stockfish
- a custom variant search engine
- a flat feature encoder for board-state learning
- self-play data generation
- dataset export for supervised value learning
- zero-dependency baseline training and evaluation scripts
- a PyTorch training path for larger experiments
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
- `Variant ML Hybrid`
  A model-backed variant engine that blends a trained value model into the custom search stack
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
- `teacherEngine`
- `teacherScore`
- `teacherDepth`
- `teacherNodes`
- `teacherMove`
- `move`
- `notation`
- `outcome`
- `finalStatus`
- `winner`

This is enough to train a first supervised value model.

The newer teacher-labeling path also makes it possible to decouple:

- which bots generate the trajectories
- which stronger search process provides the labels

That is useful because it lets the repo generate more decisive games while still keeping full teacher-score coverage.

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
- `scripts/train-value-model-torch.py`
- `scripts/eval-value-model.py`
- `scripts/value_model.py`

What exists today:

- self-play JSONL can be converted into train/validation value datasets
- search scores are normalized into `[-1, 1]`
- outcome labels are blended into the training target
- the training path supports a `linear` model and an `mlp` model
- the Torch path also supports a deeper `dense` model with configurable hidden-layer stacks
- the same JSON model format can now be exported from both the plain-Python trainer and the PyTorch trainer
- the evaluation path reports `MSE`, `RMSE`, `MAE`, `Pearson`, and non-draw outcome sign accuracy
- experiments can now test learned guidance both as leaf evaluation and as move ordering

Important implementation details:

- the current training scripts are dependency-free Python
- the newer PyTorch path is the practical route for larger Apple Silicon experiments
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
- search-vs-search teacher data with full search-score coverage improved validation quality again
- asymmetric trajectory generation plus full teacher labeling improved outcome diversity without giving up score coverage
- linear and MLP baselines both fit the value targets meaningfully
- the best offline model so far is the `exp5` Torch `mlp` trained on teacher-labeled canonical data, with validation correlation around `0.939`

But:

- the learned engine only shows a modest edge over plain variant search so far, not a dramatic one
- ordering-only guidance still tends to flatten out near parity, so the current winning configuration uses a light model blend in leaf evaluation
- a deeper stacked `dense` network did not beat the simpler one-hidden-layer Torch `mlp` on the same `exp4` teacher set

So the project is past the "toy ML scaffolding" stage and now has a real model-backed engine in the product, but it is still early rather than decisively strong.

## Tests And Verification

Relevant tests:

- `tests/computer-engines.test.js`
- `tests/position-encoder.test.js`
- `tests/engine.test.js`
- `tests/benchmark-sweep.test.js`

What is covered today:

- rule semantics
- search behavior regressions
- heuristic/search differentiation on specific positions
- encoder vector length and feature placement

This matters for ML work because the training pipeline is only as trustworthy as the legality and encoding layers beneath it.

## Experiment Tracking

Primary files:

- `scripts/benchmark-sweep.js`
- `docs/experiment-log.md`

What exists today:

- a color-balanced sweep runner for candidate-vs-reference engine comparisons
- reproducible seeded rulesets across both color assignments
- a public markdown log for recording benchmark outputs and observations

This matters because tiny asymmetric benchmark runs are too noisy to guide ML decisions. The repo now includes a cleaner path for testing whether a model is actually helping or just fitting labels offline.

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
