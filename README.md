# Chaos Chess

`Chaos Chess` is a browser-based chess variant sandbox and AI/ML playground for nonstandard chess rules.

## Preview

![Chaos Chess screenshot](assets/chaos-chess-screenshot.png)

[Demo video](assets/chaos-chess-demo.webm)

## What Makes It Different

Chaos Chess starts from standard chess, then lets you toggle five rule changes in any combination:

- Friendly Fire
- Kamikaze Captures
- Wrap-Around Files
- Double-Direction Pawns
- Jump Pawns

That gives `2^5 = 32` possible rule combinations, including classic chess.

## Why This Repo Exists

This project has three goals:

- build a fun playable chess-variant sandbox
- build a custom AI stack for rules that standard chess engines do not support
- show an end-to-end applied ML workflow: environment, search, data generation, training, evaluation, and eventual inference in the game

## Why Stockfish Is Not Enough

Stockfish is excellent for orthodox chess. It is not a drop-in engine for Chaos Chess.

Why:

- it is built for standard chess legality
- it does not understand friendly fire, kamikaze captures, wrap-around movement, or the custom pawn rules
- its evaluation assumptions are also tuned for standard chess, not for these variants

So the current split is intentional:

- classic chess uses Stockfish
- variant chess uses a custom rule-aware search engine
- ML experiments are built on top of that custom variant stack, not on top of Stockfish

## Current AI Stack

- `Human vs Human`
  Two local players share the board.
- `Stockfish`
  Used for classic chess only.
- `Variant Search`
  A custom rule-aware search backend for Chaos Chess variants.
- `Variant ML Hybrid`
  A learned value model blended into the custom variant search, exposed as a selectable engine for variant play.
- `Heuristic Baseline`
  A weaker baseline used for comparisons and experiments.

The browser UI is still primarily a playable product surface. Most of the ML work currently lives in the search, data, and training pipeline.

### AI Snapshot

| Engine | Applies To | Role | Current Read | Main Limitation |
| --- | --- | --- | --- | --- |
| `Stockfish` | Classic chess only | Orthodox chess engine | Strongest option for standard chess play | Not valid for Chaos Chess variants |
| `Variant Search` | Variant games | Custom rule-aware search baseline | Stable baseline and useful search teacher | Limited by handcrafted evaluation and browser-sized search budgets |
| `Variant ML Hybrid` | Variant games | Shipped ML-backed engine | Current best integrated variant engine; scored `0.537` and `0.525` against plain `Variant Search` on two confirmatory seed families | Edge is real but modest, and the matches are still draw-heavy |
| `Heuristic Baseline` | Variant games | Very weak fast baseline | Useful for comparisons, ablations, and data generation | Much weaker than the search-backed engines |
| `Policy / Candidate-Score / Pairwise Models` | Variant games | Experimental search-guidance paths | Strong offline learning signals and useful research direction | Not yet consistently stronger than the shipped hybrid in independent live benchmarks |

## ML Strategy

If you want the quickest visual explanation of the AI stack, start with [docs/how-the-ai-works.md](docs/how-the-ai-works.md).

### One Shared Model, Not 32 Separate Models

The current direction is **one shared model across all rule combinations**, not one model per variant preset.

The model sees:

- board features
- castling rights
- en passant state
- side-to-move information
- the five active rule flags

That is a better design than training 32 separate models:

- it keeps the system simpler
- it encourages generalization across related rulesets
- it is a stronger ML story than maintaining a pile of narrow specialist bots

### Current Representation

The current value-model pipeline uses an `842`-feature board encoding:

- `768` piece-plane features
- `1` side-to-move feature
- `4` castling-right features
- `64` en-passant-plane features
- `5` rule-flag features

Recent experiments also added a **canonical side-to-move encoding**, so learning runs no longer waste capacity relearning white/black symmetry from scratch.

Recent policy experiments add a separate **candidate-move encoder**:

- the same `842`-feature canonical board state
- plus `220` move-specific features
- total candidate vector length: `1062`

That policy encoder includes:

- from-square, to-square, and capture-square planes
- moving-piece, captured-piece, and promotion one-hots
- move flags such as capture, castle, en passant, wrap, and promotion
- normalized move geometry and legal-move-count context

### Training Loop

The current workflow is:

1. Generate self-play positions with the custom search engine.
2. Export those positions into train/validation value datasets.
3. Export legal candidate sets for teacher-move policy training when needed.
4. Train baseline models offline.
5. Evaluate those models against held-out positions.
6. Benchmark model-guided search against the handcrafted search baseline.

Current baseline models:

- `linear`
- `mlp`
- `dense` (stacked hidden layers in the Torch path)

The newer policy path trains a **listwise move-ordering model**:

- one grouped position at a time
- one teacher move per legal candidate set
- cross-entropy over the legal-move list instead of flat binary candidate labels

There are now two training paths:

- a dependency-light reference trainer in plain Python
- a `PyTorch` trainer that can use `MPS` automatically on Apple Silicon when the backend is available

The newer search-guidance experiments also include:

- calibrated shortlist reranking with softmax/confidence controls
- pointwise candidate-score regression from teacher root scores
- shortlist-aligned distillation runs where the model sees the same top-`K` move set the runtime reranker sees
- pairwise move-ranking models trained directly on teacher-preferred move comparisons
- hard-position mining based on baseline-vs-teacher disagreement and teacher root-margin filters

### Current ML Status

#### Benchmark Snapshot

| Path | Best Evidence So Far | What It Means | Current Limitation |
| --- | --- | --- | --- |
| `Variant ML Hybrid` | Sequential color-balanced confirmatory sweeps scored `0.537` and `0.525` vs plain `Variant Search` | The repo has a shipped ML-backed engine that can beat the non-ML search baseline | The edge is still modest rather than dramatic |
| `Candidate-Score Regression` | Held-out fit reached `RMSE 0.0723` and `Pearson 0.9762` on teacher root-score deltas | The model can learn teacher move-score structure very well offline | That signal has not yet translated into a reliable live strength gain |
| `Pairwise Ranking` | Best shortlist-aligned run reached about `0.956` pair accuracy and `0.915` held-out top-1 reconstruction | Relative move ranking is a credible modeling direction for search guidance | Independent live sweeps still flatten back toward parity |
| `Hard-Position Mining` | Hard-slice pairwise model reached `0.542` on a short tuning family | Mining disagreements and high-margin positions is directionally useful | The same idea fell to `0.469` on an independent confirmatory family |

What works today:

- self-play generation
- dataset export
- baseline value-model training
- candidate-move policy export
- offline evaluation
- model-guided search experiments
- calibrated policy-ordering experiments with explicit train/runtime alignment controls
- candidate-score regression experiments over teacher root scores
- disagreement-focused hard-slice mining for teacher-vs-baseline failures
- a browser-exposed ML-backed variant engine built from a curated trained model

What does **not** work yet:

- the learned engine is still only modestly stronger than the plain variant-search baseline
- the ML-backed engine is still early-stage and nowhere near Stockfish-level strength on classic chess
- the newer policy-ordering model is strong offline, but not yet consistently above the current value-hybrid in independent live benchmarks
- the newer candidate-score regressors fit teacher root scores very well offline, but still have not produced a clear live strength gain
- the new hard-slice pairwise models can improve on short tuning families, but still flatten back near parity or mild underperformance on independent seed families

One methodological note matters here: because the search engines are wall-clock bounded, benchmark sweeps must be run sequentially. Parallel engine matches distort the effective think time and are not treated as valid evidence.

That is important context: this repo already contains a real ML pipeline and a playable ML-backed variant engine, but the learned evaluator is still early rather than fully mature.

## Running It

Serve the app locally:

```bash
make serve
```

Then open `http://localhost:8000`.

Useful checks:

```bash
make test
make check
```

## ML Workflow

Generate self-play data:

```bash
make selfplay
```

Export train/validation value datasets:

```bash
make export-dataset
```

Export train/validation policy datasets:

```bash
make export-policy-dataset
```

Export train/validation soft-policy distillation datasets:

```bash
make export-policy-distill-dataset
```

Both policy exporters can also mine harder states directly with flags like:

- `--min-teacher-gap 40`
- `--min-root-margin 40`

Export train/validation candidate-score datasets from teacher root scores:

```bash
make export-candidate-score-dataset
```

Export train/validation pairwise move-ranking datasets:

```bash
make export-pairwise-policy-dataset
```

Train a baseline value model:

```bash
make train-value
```

Install the Torch stack into a local virtualenv:

```bash
make setup-torch
```

Train with PyTorch:

```bash
make train-value-torch
```

Train a grouped policy-ordering model with PyTorch:

```bash
make train-policy-torch
```

Train a soft-policy distillation model with PyTorch:

```bash
make train-policy-distill-torch
```

Train a pairwise move-ranking model with PyTorch:

```bash
make train-policy-pairwise-torch
```

Evaluate a saved value model:

```bash
make eval-value
```

Run a benchmark:

```bash
make benchmark
```

Run a color-balanced sweep when you want a less noisy engine comparison:

```bash
make benchmark-sweep
```

The lower-level scripts are also useful directly when running experiments:

```bash
node scripts/selfplay.js --games 40 --rules random --white search --black heuristic --encoding canonical
node scripts/export-dataset.js --input ml/datasets/selfplay.jsonl --search-weight 1 --outcome-weight 0
node scripts/export-policy-dataset.js --input ml/datasets/selfplay.jsonl --label-field teacher
node scripts/export-policy-distill-dataset.js --input ml/datasets/selfplay.jsonl --teacher-model assets/models/variant-ml-hybrid-v1.json --teacher-blend 0.10
node scripts/export-policy-distill-dataset.js --input ml/datasets/selfplay.jsonl --teacher-model assets/models/variant-ml-hybrid-v1.json --teacher-blend 0.10 --only-disagreements true --min-teacher-gap 40 --candidate-top-k 6
node scripts/export-candidate-score-dataset.js --train-input ml/datasets/policy-distill-train.jsonl --validation-input ml/datasets/policy-distill-validation.jsonl --score-field targetScoreDelta
node scripts/export-pairwise-policy-dataset.js --train-input ml/datasets/policy-distill-train.jsonl --validation-input ml/datasets/policy-distill-validation.jsonl --pair-mode best_vs_rest
python3 scripts/train-value-model.py --model linear --epochs 20
./.venv/bin/python scripts/train-value-model-torch.py --model mlp --hidden-size 64 --epochs 24
./.venv/bin/python scripts/train-value-model-torch.py --model dense --hidden-sizes 128,64 --epochs 20
./.venv/bin/python scripts/train-policy-model-torch.py --model mlp --hidden-size 256 --epochs 18
./.venv/bin/python scripts/train-policy-distill-torch.py --model mlp --hidden-size 256 --epochs 18
./.venv/bin/python scripts/train-policy-pairwise-torch.py --model mlp --hidden-size 256 --epochs 24
python3 scripts/eval-value-model.py --model ml/models/value-model.json
node scripts/benchmark.js --games 12 --rules random --white search --black heuristic
node scripts/benchmark-sweep.js --candidate hybrid --reference search --games-per-seed 8 --seeds s1,s2,s3
```

For public experiment notes and observations, see [docs/experiment-log.md](docs/experiment-log.md).

## Rule Semantics

Each rule has a specific implementation. The details matter.

### Friendly Fire

Rules:

- any piece may capture an allied piece
- no move may capture an allied king
- a king may move onto an allied non-king piece and remove it, as long as the destination square is still safe
- friendly-fire captures still obey normal self-check rules

Nuance:

- this changes occupancy, not attack geometry
- your own pieces still block sliding attacks until they are actually removed

### Kamikaze

Rules:

- on any capture, the captured piece is removed
- the capturing piece is also removed immediately
- the destination square is left empty
- there is no blast radius

Nuance:

- kings cannot make capturing moves in kamikaze mode, because a legal move may not destroy your own king
- a kamikaze capture can still be useful defensively if removing both pieces breaks an attack line

### Wrap-Around Files

Rules:

- horizontal movement may cross between file `a` and file `h`
- this applies to normal movement, captures, knight jumps, and pawn diagonals
- only files wrap; ranks do not

Nuance:

- the `a`/`h` seam is a mobility seam, not a check seam
- a move may wrap, but check detection never wraps
- example: a rook may move from `a1` to `h1` in wrap mode, but it does not give wrap-around check through that seam

### Double-Direction Pawns

Rules:

- pawns may move one square forward or one square backward
- pawn captures are also mirrored forward and backward
- promotion still only happens on the opponent's back rank

Nuance:

- this is a mirrored pawn model, not just backward non-capturing movement
- that keeps movement and capture logic internally consistent

### Jump Pawns

Rules:

- a pawn may always move either one square or two squares in a straight line
- the path must still be clear
- the two-step is not restricted to the starting rank

Nuance:

- en passant still exists
- because a pawn can now double-step from anywhere, en passant opportunities can also arise from anywhere
- if double-direction pawns is also enabled, that logic applies in both directions

## Variant Interaction Notes

- `Friendly Fire + Check Rules`
  Removing your own blocker is legal only if your king remains safe afterward.
- `Kamikaze + Promotion`
  If a pawn captures on the last rank in kamikaze mode, it still explodes, so no promoted piece remains.
- `Wrap Around + Check`
  Movement may wrap, but kings never evaluate wrapped attacks as checks.
- `Double-Direction Pawns + Jump Pawns`
  Pawns may move one or two squares in either allowed direction, with normal path-clear requirements.
- `Jump Pawns + En Passant`
  The engine stores the skipped square after any legal two-step pawn move, not just opening-rank moves.

## Standard Rules Kept

The following standard rules still exist where they make sense:

- check and self-check filtering
- checkmate
- stalemate
- castling
- en passant
- promotion

Promotion is chosen dynamically when a pawn reaches the last rank.

## Repo Map

- `src/engine.js`
  Rules engine, legality checks, state transitions, move descriptions
- `src/classic-ai.js`
  Browser-side Stockfish adapter
- `src/computer-engines.js`
  Shared computer-engine layer, heuristic/search engines, model-guided search hooks
- `src/position-encoder.js`
  Feature encoding for ML experiments
- `src/app.js`
  Browser UI and interaction layer
- `scripts/selfplay.js`
  Self-play data generation
- `scripts/export-dataset.js`
  Dataset export for value-model training
- `scripts/train-value-model.py`
  Baseline offline training
- `scripts/eval-value-model.py`
  Offline evaluation
- `scripts/benchmark.js`
  Head-to-head engine benchmarking

## Docs

- [docs/README.md](docs/README.md)
  Documentation index
- [docs/how-the-ai-works.md](docs/how-the-ai-works.md)
  Visual walkthrough of the search and ML stack
- [docs/ml-status.md](docs/ml-status.md)
  What is already built
- [docs/ai-architecture.md](docs/ai-architecture.md)
  AI/runtime system design
- [docs/ml-roadmap.md](docs/ml-roadmap.md)
  What should happen next

## License And Dependencies

- The Stockfish browser assets live in `vendor/stockfish/`.
- The upstream GPL license text is included in `vendor/stockfish/Copying.txt`.
