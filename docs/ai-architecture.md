# AI Architecture Spec

Related docs:

- [ML Status](ml-status.md)
- [ML Roadmap](ml-roadmap.md)

## Goals

This project needs to satisfy three goals at the same time:

1. Build a fun computer opponent for `Chaos Chess`.
2. Create a clean sandbox for experimentation.
3. Make the repo read clearly as an applied ML project, not only a game project.

The architecture should therefore support both classical search and learned components without forcing UI rewrites each time the backend changes.

## Principles

- Legality stays in `src/engine.js`. AI code never reimplements move rules.
- Every AI backend exposes the same runtime contract.
- Each stage must remain playable, even before the ML-heavy stages exist.
- Learned models augment or replace evaluation, not move legality.
- The browser app should remain the primary demo surface.

## Runtime Contract

Every computer opponent backend should implement this interface:

```js
{
  init(): Promise<void>,
  requestMove(game, options): Promise<{
    from: { x: number, y: number },
    to: { x: number, y: number },
    promotion: "q" | "r" | "b" | "n" | null
  } | null>,
  reset(): void,
  getInfo(): {
    id: string,
    label: string,
    family: "classic-search" | "variant-heuristic" | "variant-search" | "variant-hybrid",
    supportsRules(rules): boolean
  }
}
```

The app should decide which backend to use by asking the backend registry which implementation supports the current ruleset.

## Initial Backend Families

### 1. Classic Search Backend

- Uses browser-based Stockfish.
- Supports classic chess only.
- Exists to provide a strong baseline and polished public demo for standard rules.

### 2. Variant Heuristic Backend

- Supports all current variant combinations.
- Uses the existing legality engine plus a handcrafted evaluation function.
- This is the first custom backend and the first step toward a real variant AI stack.

### 3. Variant Search Backend

- Uses iterative deepening, alpha-beta, and transposition storage.
- Reuses the same evaluation interface as the heuristic backend.
- Becomes the self-play teacher for later ML work.

### 4. Variant Hybrid Backend

- Uses search for planning and a learned evaluator for leaf scoring or move ordering.
- This is the backend that most clearly demonstrates applied ML depth.

## Milestone Ladder

### Milestone A: Engine Abstraction

Deliverables:

- Shared runtime interface for computer opponents.
- Stockfish wrapped behind that interface.
- Prototype variant backend behind the same interface.
- App chooses backend by active ruleset.

Success condition:

- The UI no longer cares which AI implementation is active.

### Milestone B: Stronger Variant Search

Deliverables:

- Search-specific move expansion helpers.
- Minimax or negamax search.
- Alpha-beta pruning.
- Better evaluation terms.
- Search moved into a Worker when needed.

Success condition:

- Variant games have a competent legal opponent with predictable latency.

### Milestone C: Data And Experiment Pipeline

Deliverables:

- Self-play generator.
- Position encoder.
- Dataset format.
- Benchmark runner.
- Evaluation report format.

Success condition:

- The repo can generate reproducible training data and compare engines quantitatively.

### Milestone D: Learned Evaluation

Deliverables:

- Board-to-feature encoder.
- Small value model.
- Training script.
- Checkpoint format.
- Runtime model loader.

Success condition:

- The learned evaluator beats or complements the handcrafted evaluator on held-out positions or self-play.

### Milestone E: Hybrid Search + ML

Deliverables:

- Search engine that can call either heuristic or learned evaluation.
- A/B comparison harness.
- Model-backed browser demo mode.

Success condition:

- The repo demonstrates a full applied ML loop: environment, data, training, inference, and product integration.

## Evaluation Strategy

### Handcrafted Evaluation

The first custom variant backend should score positions using:

- material balance
- immediate mate or stalemate detection
- check pressure
- mobility
- pawn advancement
- castling and king safety cues

This evaluator does not need to be strong. It needs to be deterministic, explainable, and compatible with all variant rules.

### Learned Evaluation

The first learned model should be a compact value model, not an LLM.

Recommended inputs:

- 12 piece planes
- side to move
- castling rights
- en passant square
- 5 variant rule flags

Recommended targets:

- normalized search score
- self-play game outcome

Recommended first use:

- leaf evaluation
- move ordering hint

## Data Pipeline

The ML pipeline should be kept separate from the browser runtime.

Suggested flow:

1. Generate self-play games using the stronger search backend.
2. Serialize positions, legal move counts, rules, and outcomes.
3. Train a value model offline.
4. Export a small checkpoint for browser inference.
5. Compare heuristic-only and hybrid engines through benchmarks.

## Benchmarks

Track these from the start:

- average move latency
- legal move failure count
- win rate vs random
- win rate vs previous engine version
- win rate by ruleset family
- nodes or evaluated positions per move

The project should keep a simple benchmark table in version control once multiple backends exist.

## Proposed File Layout

```text
docs/
  ai-architecture.md
src/
  app.js
  engine.js
  classic-ai.js
  computer-engines.js
  ai/
    worker.js
    search.js
    eval/
      heuristic.js
      model.js
scripts/
  selfplay.js
  benchmark.js
  train-value-model.py
ml/
  datasets/
  experiments/
  models/
tests/
  engine.test.js
  computer-engines.test.js
```

Not every path above needs to exist immediately. It is the intended shape.

## Immediate Implementation Plan

The first implementation slice should do four things:

1. Introduce a shared computer-engine module.
2. Wrap Stockfish behind the shared `requestMove()` contract.
3. Add a heuristic variant backend that can play all supported rule combinations.
4. Switch the app to backend selection by ruleset instead of hardcoded Stockfish-only logic.

This milestone is intentionally not ML yet. It creates the stable baseline that the ML stages will extend.
