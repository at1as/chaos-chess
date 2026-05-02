# Experiment Log

This file records the benchmark runs and observations that matter enough to keep in the public repo.

The raw JSON outputs still live under ignored `ml/benchmarks/`, but the goal here is to preserve:

- what was run
- why it was run
- what the result means
- what should happen next

## Methodology Notes

Important benchmarking rules for this repo:

- `--rules random` must be seeded, or repeated runs are not comparable
- engine comparisons should be color-balanced, not just candidate-as-White
- very short runs are useful for smoke tests, not for claims
- offline validation metrics matter, but gameplay benchmarks decide whether a model is actually helping

The current benchmark utilities:

- `scripts/benchmark.js`
  Single matchup run
- `scripts/benchmark-sweep.js`
  Color-balanced multi-seed sweep from candidate-engine perspective

## 2026-05-01: Torch MLP Ordering-Only Baseline

### Motivation

The first practical question was not "can we train a model?" It was "can a trained model help the custom variant search engine without making it worse?"

The most conservative integration point so far is move ordering:

- keep the handcrafted search and legality engine
- keep the handcrafted leaf evaluator
- let the model bias move ordering only

That is safer than replacing evaluation outright.

### Model Under Test

- model: `ml/models/exp3-torch-mlp.json`
- training stack: `PyTorch`
- encoding: `canonical`
- integration mode: ordering-only

### Initial Signal

Early one-seed results at `60ms` per move were mildly encouraging but still too noisy to trust. The main lesson from that pass was methodological:

- the seed needed to be fixed
- the comparison needed to be color-balanced

That led to the sweep tooling now in the repo.

## 2026-05-01: Color-Balanced Sweep Infrastructure

### What Changed

- added seeded random-rules support to self-play and benchmark scripts
- added `scripts/benchmark-sweep.js`
- added a candidate-perspective aggregate so color-swapped runs can be compared fairly

This was not model work by itself. It was necessary measurement work.

## 2026-05-01: Early Asymmetric `60ms` Signal

### Setup

- candidate engine: `hybrid`
- reference engine: `search`
- candidate ordering model: `ml/models/exp3-torch-mlp.json`
- candidate ordering weight: `0.15`
- rules: `random`
- move time: `60ms`
- seeds: `exp4-fixed-seed,sweep-1,sweep-2,sweep-3,sweep-4`
- games per seed: `50`

### Aggregate Result

- total games: `250`
- candidate wins: `29`
- reference wins: `25`
- draws: `196`
- candidate score: `0.508`

### Interpretation

This was the first point where the ML path looked plausibly useful instead of purely academic.

But the result is still weak evidence:

- the gain is small
- the draw rate is extremely high
- the run was not color-balanced

So the correct read is:

- promising
- not yet decisive

This result was useful because it justified building better benchmark tooling. It was not strong enough to claim that the hybrid engine was actually better.

## 2026-05-01: Color-Balanced Weight Tuning At `100ms`

### Setup

- candidate engine: `hybrid`
- reference engine: `search`
- candidate ordering model: `ml/models/exp3-torch-mlp.json`
- rules: `random`
- move time: `100ms`
- max plies: `60`
- seeds: `tune-a,tune-b,tune-c`
- games per seed per color: `4`

### Results

- ordering weight `0.05`
  `4W / 3L / 17D`, score `0.521`
- ordering weight `0.10`
  `4W / 3L / 17D`, score `0.521`
- ordering weight `0.15`
  `3W / 5L / 16D`, score `0.458`
- ordering weight `0.20`
  `4W / 3L / 17D`, score `0.521`

### Interpretation

The model was not producing a large stable strength effect on this benchmark family.

What we learned:

- `0.15` was clearly not better here
- `0.05`, `0.10`, and `0.20` behaved identically on this seeded sample
- the ordering model is nudging move choice, but not enough to produce a strong, robust separation yet

## 2026-05-01: Confirmatory Color-Balanced Sweep

### Setup

Two runs on the same benchmark family:

- control: `search` vs `search`
- candidate: `hybrid` vs `search`
- candidate ordering model: `ml/models/exp3-torch-mlp.json`
- candidate ordering weight: `0.10`
- rules: `random`
- move time: `100ms`
- max plies: `60`
- seeds: `confirm-a,confirm-b,confirm-c,confirm-d,confirm-e`
- games per seed per color: `4`

### Results

- `search` vs `search`
  `6W / 6L / 28D`, score `0.500`
- `hybrid` vs `search`
  `7W / 7L / 26D`, score `0.500`

### Interpretation

This is the current best read:

- the learned ordering model does not yet show a confirmed strength gain over plain search at this benchmark budget
- the earlier positive signal did not survive a cleaner confirmatory run
- the parity result is still useful, because it means the model is not obviously damaging search either

One interesting detail:

- in both the control and hybrid runs, the candidate side scored better as Black than as White

That suggests the benchmark family itself carries some side-specific bias under these shallow random-rule settings, which is exactly why the color-balanced aggregate matters.

## 2026-05-01: Full-Coverage Search-Teacher Dataset (`exp4`)

### Motivation

The previous best model (`exp3`) had an avoidable weakness:

- it came from `search vs heuristic`
- only the search side produced real `searchScore` labels
- effective search-label coverage was only about `50%`

So the next experiment moved to:

- `search vs search`
- canonical encoding
- search-only targets
- deeper teacher settings than the earlier light runs

### Dataset

- self-play games: `36`
- rules: `random`
- move time: `120ms`
- max depth: `5`
- max plies: `40`
- total training samples after export: `1372`
- search-score coverage: `1.0`

### Immediate Result

This teacher dataset was a real quality jump.

Compared with the earlier `exp3` teacher:

- label coverage improved from about `0.5` to `1.0`
- validation correlation improved materially for both linear and neural models

## 2026-05-01: `exp4` Offline Model Comparison

### Models

- Torch `linear`
- Torch `mlp` with hidden size `64`
- Torch `mlp` with hidden size `128`
- Torch `dense` with hidden sizes `128,64`

### Results

- `exp4` Torch `linear`
  RMSE `0.2349`, Pearson `0.9159`
- `exp4` Torch `mlp64`
  RMSE `0.2257`, Pearson `0.9179`
- `exp4` Torch `mlp128`
  RMSE `0.2263`, Pearson `0.9149`
- `exp4` Torch `dense 128x64`
  RMSE `0.2312`, Pearson `0.9110`

### Interpretation

Two useful conclusions came out of this:

- better teacher data mattered more than simply making the network deeper
- the best model on this dataset was still the simpler one-hidden-layer `mlp64`

That is a good ML result, not a disappointing one. It means the project is actually measuring tradeoffs instead of assuming that more layers automatically help.

## 2026-05-01: `exp4` Gameplay Check

### Setup

- candidate engine: `hybrid`
- reference engine: `search`
- candidate ordering model: `ml/models/exp4-torch-mlp64.json`
- candidate ordering weight: `0.10`
- rules: `random`
- move time: `100ms`
- max plies: `60`
- seeds: `confirm-a,confirm-b,confirm-c,confirm-d,confirm-e`
- games per seed per color: `4`

### Result

- `hybrid` vs `search`
  `7W / 7L / 26D`, score `0.500`

### Interpretation

This is the current bottleneck:

- the stronger offline model did **not** yet turn into a stronger playing engine
- that points more toward integration and target-design limits than raw model-fit limits

The strongest current interpretation is:

- data quality improved
- offline value prediction improved
- gameplay strength did not move clearly yet

## 2026-05-01: Deeper-Model Support

The repo now supports a deeper Torch model format:

- `--model dense`
- `--hidden-sizes 128,64`

That model format is now supported in:

- Torch training
- Python evaluation
- JS runtime inference for hybrid search

The first dense run did not beat `mlp64`, but the support is now in place for future experiments.

## 2026-05-01: Teacher-Labeled Asymmetric Trajectories (`exp5`)

### Motivation

The `exp4` dataset solved score coverage, but it still had weak outcome diversity:

- it used `search vs search`
- only `5/36` games ended decisively

So the next step was to separate:

- trajectory generation
- teacher labeling

That allowed the project to generate more decisive games with asymmetric play, while still labeling every position with a stronger search teacher.

### What Changed

The self-play pipeline now supports:

- a trajectory bot pair
- an independent teacher search process
- exported `teacherScore`, `teacherDepth`, `teacherNodes`, and `teacherMove`
- dataset export against `teacherScore` instead of only `searchScore`

### Dataset

`exp5` combined two mirrored runs:

- `search` vs `heuristic`
- `heuristic` vs `search`

Teacher settings:

- teacher bot: `search`
- teacher move time: `140ms`
- teacher max depth: `5`

Combined outcome summary:

- games: `40`
- decisive games: `13`
- active/nonterminal at ply cap: `27`

This was a better supervision mix than `exp4`:

- full teacher-score coverage remained at `1.0`
- decisive outcomes increased materially
- the trajectories were less homogeneous than `search vs search`

## 2026-05-01: `exp5` Offline Model Comparison

### Datasets

- `exp5-searchonly`
  teacher-score target only
- `exp5-blend9010`
  `0.9 * teacherScore + 0.1 * outcome`

### Results

- `exp5-searchonly-mlp64`
  RMSE `0.1955`, Pearson `0.9371`
- `exp5-blend9010-mlp64`
  RMSE `0.1917`, Pearson `0.9394`

### Interpretation

This was the best offline result so far.

Compared with the strongest earlier `exp4` model:

- the target fit improved substantially
- the outcome-blended variant was slightly better than pure teacher-score regression

That gave the first strong reason to test blended evaluation in gameplay again.

## 2026-05-01: `exp5` Gameplay Results

### Candidates

- `exp5-searchonly-mlp64` as ordering-only guidance
- `exp5-blend9010-mlp64` as a light leaf-eval blend

### Tuning Sweep

At `100ms`, random rules, seeds `tune-a,tune-b,tune-c`:

- `exp5-searchonly` ordering-only, weight `0.10`
  `4W / 4L / 16D`, score `0.500`
- `exp5-blend9010` leaf blend, weight `0.10`
  `4W / 3L / 17D`, score `0.521`

### Confirmatory Sweeps

At `100ms`, random rules, `4` games per seed per color:

- seeds `confirm-a..confirm-e`
  `3W / 0L / 37D`, score `0.537`
- seeds `verify-a..verify-e`
  `4W / 2L / 34D`, score `0.525`

### Current Best Read

This is the first model configuration that looks strong enough to expose in the product:

- it beats plain `Variant Search` on multiple independent color-balanced seed families
- the edge is modest, not dramatic
- the best configuration is **not** the pure ordering model
- the best configuration so far is:
  `exp5-blend9010-mlp64` with a `0.10` model blend

Across the two larger confirmatory seed families, that engine scored above parity against plain `Variant Search`.

## 2026-05-01: Product Promotion

The repo now includes a curated browser model artifact:

- `assets/models/variant-ml-hybrid-v1.json`

That model is:

- derived from `exp5-blend9010-mlp64`
- minified and rounded for browser use
- wired into the app as `Variant ML Hybrid`

This is an important threshold for the project:

- the ML work is no longer only offline infrastructure
- there is now a playable, model-backed engine in the product itself

## Current Best Read

As of now:

- the learned models clearly learn something offline
- the canonical encoding was a real improvement
- full-coverage search-vs-search teacher data was another real improvement
- teacher-labeled asymmetric trajectories were another real improvement
- ordering-only guidance is the safest integration mode so far
- a light outcome-blended leaf evaluator is now modestly stronger than plain variant search on repeated seed families

## Next Benchmarking Step

The next useful experiment is no longer "can we get above parity at all?" The next step is to make that edge larger and more stable.

Questions to answer:

- does a slightly different outcome/search blend outperform `0.90 / 0.10`?
- can a stronger teacher pass or a larger dataset push the live edge above the current modest margin?
- is policy-style supervision the next lever now that value-only regression finally produced a positive gameplay signal?

## 2026-05-01: `exp6` Policy-Style Move Ordering

### Motivation

By the end of `exp5`, value modeling had clearly crossed the line from "toy" to "useful," but the live edge was still small and unstable.

That suggested a different bottleneck:

- the engine needed help valuing positions
- but it also needed help deciding which legal moves to search first

So `exp6` introduced a policy-style path instead of another round of value-only regression.

### Data And Representation

New infrastructure added for `exp6`:

- self-play samples now preserve full `stateSnapshot` data
- `src/move-encoder.js` encodes legal candidates directly
- `scripts/export-policy-dataset.js` expands trajectories into teacher-labeled candidate sets
- `scripts/train-policy-model-torch.py` trains grouped listwise policy models

Policy representation:

- board-state features: `842`
- move-specific features: `220`
- total candidate vector length: `1062`

The move-specific block includes:

- from-square, to-square, and capture-square planes
- moving-piece, captured-piece, and promotion one-hots
- move flags for capture, friendly capture, castle, en passant, wrap, and promotion
- normalized move deltas plus legal-move-count context

### Teacher Setup

For `exp6`, the policy teacher was the current shipped value-hybrid engine:

- teacher bot: `hybrid`
- teacher model: `assets/models/variant-ml-hybrid-v1.json`
- teacher blend: `0.10`

Trajectory generation mixed several player pairings to widen the state distribution:

- `search vs heuristic`
- `heuristic vs search`
- `search vs search`

Combined dataset:

- `54` self-play games
- `2394` labeled positions
- `74354` legal candidates
- average legal move count: `42.14`

### Model Comparison

Grouped listwise policy training on the same split:

- `exp6-policy-mlp256`
  top-1 `0.7307`, mean teacher probability `0.6471`
- `exp6-policy-dense256x128`
  top-1 `0.7265`, mean teacher probability `0.6395`
- `exp6-policy-dense512x256x128`
  top-1 `0.7161`, mean teacher probability `0.6537`

Important read:

- the best policy model was the simpler `mlp256`
- more depth did not help
- grouped listwise supervision worked much better than the earlier flat pilot path

### Online Integration Attempts

First attempt:

- use the policy model for move ordering at every searched node

Result:

- too aggressive
- moderate weights often made the engine worse against plain `Variant Search`

That suggested distribution shift:

- the policy model was trained on actual game positions
- but full-tree integration forced it to rank deeper search states it had never really seen

### Root-Limited Policy Guidance

To test that theory, search integration gained `policyMaxPly`, which caps how deep the policy model is allowed to influence move ordering.

Best promising configuration:

- policy model: `exp6-policy-mlp256`
- policy weight: `10`
- policy max ply: `0` (root only)

Matched-seed comparison at `60ms`, random rules, `3` games per seed per color, seeds `exp6rt1..exp6rt3`:

- baseline hybrid vs search
  `1W / 2L / 15D`, score `0.472`
- root-only policy hybrid vs search
  `3W / 1L / 14D`, score `0.556`

This was the first sign that root-only policy guidance could help without destabilizing deeper search.

### Independent Verification

Independent seeds `exp6rv1..exp6rv4`, `4` games per seed per color, same `60ms` budget:

- baseline hybrid vs search
  `2W / 1L / 29D`, score `0.516`
- root-only policy hybrid vs search
  `2W / 1L / 29D`, score `0.516`

### Current Read

`exp6` is a real technical improvement to the repo even though it is not yet a product promotion:

- the repo now supports full teacher-labeled policy training
- the move-ordering model is strong offline
- root-only guidance is the most defensible live integration tried so far
- but the online edge is not stable enough yet to replace the shipped `Variant ML Hybrid`

So the honest conclusion is:

- `exp6` upgraded the ML architecture substantially
- it did **not** yet produce a consistently stronger public engine

### Next Step After `exp6`

The next useful experiments are:

- more teacher data, especially from stronger or more varied teachers
- depth-aware policy schedules instead of a hard root cutoff
- joint value-plus-policy training
- policy fine-tuning specifically on positions where search is currently indecisive
