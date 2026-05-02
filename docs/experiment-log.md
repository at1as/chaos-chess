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
- wall-clock bounded engine matches must be run sequentially; parallel sweeps distort effective think time and are not trusted for claims

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

## 2026-05-01: `exp6b` Disagreement-Focused Policy Fine-Tuning

### Motivation

The first `exp6` policy models were trained on all teacher-labeled positions.

That is broad, but it also spends a lot of capacity on positions where:

- plain `Variant Search` already agrees with the stronger hybrid teacher
- a learned root prior cannot change anything meaningful

So the next refinement was to train on the positions that actually matter:

- `engine == search`
- `move != teacherMove`

That turns the policy task into "learn where plain search is wrong," which is a much more targeted signal for root-only guidance.

### Datasets

Two filtered exports were created from the same `exp6` corpus:

- `exp6-search-disagree`
  all search-vs-teacher disagreement positions
- `exp6-search-disagree-early`
  the same, but capped to `ply <= 24`

Sizes:

- `exp6-search-disagree`
  `966` positions, `31692` candidates
- `exp6-search-disagree-early`
  `589` positions, `21982` candidates

### Offline Results

Using the same listwise `mlp256` policy trainer:

- `exp6-search-disagree-mlp256`
  top-1 `0.6839`, mean teacher probability `0.5880`
- `exp6-search-disagree-early-mlp256`
  top-1 `0.7542`, mean teacher probability `0.6622`

Important read:

- the early disagreement slice was the strongest offline policy model so far
- that result was better than the broader `exp6-policy-mlp256` model
- so the filtering idea was not noise; it created a cleaner supervised problem

### Online Results

Root-only integration, `60ms`, random rules, seeds `exp6hd1..exp6hd3`:

- baseline hybrid vs search
  `1W / 1L / 16D`, score `0.500`
- disagreement-early model, root-only, weight `10`
  `0W / 1L / 17D`, score `0.472`
- disagreement-early model, root-only, weight `15`
  `0W / 1L / 17D`, score `0.472`

### Interpretation

This is a useful failure, not wasted work.

What it means:

- disagreement-focused policy supervision clearly improves the offline task
- but the offline target is still not perfectly aligned with stronger live play
- simply becoming better at imitating the teacher on filtered root positions is not enough on its own

That points to the next real gap:

- we likely need better *search-state matching*, not just better label curation
- root-time positions from played games are still not the same as the states the engine most struggles with under time pressure

### Updated Read After `exp6b`

The strongest current policy story is:

- broad listwise policy training works
- root-only integration is much safer than full-tree policy ordering
- targeted disagreement filtering improves offline top-1 substantially
- but none of the policy variants are yet stable enough online to replace the shipped value-hybrid engine

## 2026-05-01: `exp6c` Top-K Root Reranking

One more integration defense was added after `exp6b`:

- let policy touch only the root
- and only rerank the top heuristic candidates instead of the full legal move list

This was implemented as `policyTopK`.

Idea:

- preserve the search engine's tactical priors
- let the model act more like a precision reranker than a global reorderer

Result on a small matched seed family at `60ms`, seeds `exp6tk1..exp6tk3`:

- baseline hybrid vs search
  `2W / 0L / 16D`, score `0.556`
- root-only policy, full candidate list
  `0W / 0L / 18D`, score `0.500`
- root-only policy, top-`6` rerank
  `1W / 0L / 17D`, score `0.528`

Interpretation:

- the top-`6` rerank was safer than unrestricted root-only policy on that seed family
- but it still did not beat the baseline there
- so `policyTopK` is a useful control surface, not yet a breakthrough

## 2026-05-01: `exp6d` Soft-Policy Distillation

### Motivation

The one-hot policy path may still be too lossy:

- it only tells the student which move won
- it throws away how much better that move was than the alternatives

So the next step was to expose full teacher root scores from search and train against a softened move distribution instead of a one-hot label.

### New Infrastructure

Added:

- `searchPosition(..., { includeRootScores: true })`
- `scripts/export-policy-distill-dataset.js`
- `scripts/train-policy-distill-torch.py`

This allows:

- rerunning a stronger teacher on saved root states
- collecting scored legal candidates
- converting those scores into a soft target distribution
- training a student against the whole preference distribution

### First Distillation Attempt

Dataset:

- early disagreement slice from `exp6`
- teacher: `Variant ML Hybrid`
- temperature: `220`

Observation:

- the target was far too flat
- mean best-move target probability was only about `0.051`

That made the soft target too close to uniform for a practical reranker.

### Sharpened Distillation

Refined settings:

- temperature: `80`
- truncate target mass to teacher top `6` moves

This improved the target shape materially:

- mean best-move target probability: about `0.219`
- mean entropy dropped substantially

### Offline Result

Model:

- `exp6-distill-early-top6-mlp256`

Validation:

- top-1 `0.6695`
- mean teacher probability `0.1897`

Compared with the best one-hot early-disagreement policy model:

- the distillation model was worse on top-1
- but it tracked a richer target and was still worth testing online

### Online Result

Root-only, top-`6` reranking, `60ms`, seeds `exp6sd1..exp6sd3`:

- baseline hybrid vs search
  `0W / 1L / 17D`, score `0.472`
- distilled root-only top-`6` rerank
  `1W / 1L / 16D`, score `0.500`

### Interpretation

This was another useful partial result:

- richer teacher targets did not break through decisively
- but they did recover some of the gap relative to baseline
- the main limitation still appears to be live search-state mismatch, not lack of policy-training machinery

## 2026-05-01: Calibrated Shortlist Policy Reranking

### Motivation

The shortlist policy models looked better offline than they did online, so the next hypothesis was not "bigger network."

It was "runtime mismatch."

Two concrete mismatches were addressed:

- grouped policy logits were being consumed as raw scalar scores
- shortlist-trained models were seeing full legal-move counts at runtime instead of shortlist counts

### Runtime Changes

Search ordering gained:

- optional shortlist softmax conversion
- optional confidence-gap gating before policy pressure is applied
- optional shortlist-count feature mode so the policy model can see the same legal-move-count semantics it saw during training

### Benchmark Hygiene Lesson

An early attempt to compare these variants in parallel produced obviously conflicting results.

That was not a model signal. It was a methodology bug:

- these searches are wall-clock bounded
- parallel runs steal CPU from each other
- that changes effective search depth

From this point on, the repo treats sequential color-balanced sweeps as the only valid evidence for engine-strength comparisons.

### Sequential Results

Matched seeds `exp6sl1..exp6sl3`, `60ms`, `3` games per seed per color:

- baseline `Variant ML Hybrid` vs `search`
  `2W / 1L / 15D`, score `0.528`
- shortlist one-hot policy, raw logits, old full-count mismatch
  `0W / 1L / 17D`, score `0.472`
- shortlist one-hot policy, raw logits, shortlist-count fix
  `1W / 1L / 16D`, score `0.500`
- shortlist one-hot policy, softmax reranking, shortlist-count fix
  `2W / 1L / 15D`, score `0.528`

Independent seeds `exp6sv1..exp6sv4`, `60ms`, `4` games per seed per color:

- baseline `Variant ML Hybrid` vs `search`
  `2W / 3L / 27D`, score `0.484`
- shortlist one-hot policy, raw logits, shortlist-count fix
  `2W / 3L / 27D`, score `0.484`
- shortlist one-hot policy, softmax reranking, shortlist-count fix
  `2W / 4L / 26D`, score `0.469`

### Interpretation

This was still a useful result even though it was not a win:

- the feature-count mismatch was real
- fixing it removed a clear avoidable failure mode
- calibrated reranking was safer than the old raw-logit path on the first seed family
- but it still did not create a stable edge on independent seeds

So the online problem was not just inference calibration.

## 2026-05-01: Broad Candidate-Score Regression (`exp7`)

### Motivation

The next idea was to stop asking a grouped classifier to act like a scalar move scorer.

Instead:

- rerun the teacher search
- keep teacher root-score deltas per candidate
- train a pointwise regressor directly on move desirability

This better matches how the runtime search loop actually consumes move scores.

### Dataset

Source:

- `exp6-distill-early-top6-*`

Converted with:

- `scripts/export-candidate-score-dataset.js`
- target field: `targetScoreDelta`
- search scale: `300`

Totals:

- `21982` candidate samples
- `589` positions
- average legal candidates per position: about `37.3`

### Offline Result

Models:

- `exp7-candidate-score-linear`
  RMSE `0.1142`, Pearson `0.9392`
- `exp7-candidate-score-mlp256`
  RMSE `0.0723`, Pearson `0.9762`

This was one of the strongest offline fits in the repo so far.

### Online Result

Matched seeds `exp6sl1..exp6sl3`, `60ms`, `3` games per seed per color:

- root-only top-`6` reranking, weight `200`
  `1W / 1L / 16D`, score `0.500`
- root-only full-list reranking, weight `200`
  `1W / 2L / 15D`, score `0.472`
- root-only top-`6` reranking, weight `80`
  `1W / 1L / 16D`, score `0.500`

### Interpretation

This was another strong negative result:

- the model clearly learned the teacher root-score structure offline
- but even a well-fit pointwise scorer did not convert into a clear live strength gain

That made the remaining gap look even more like search integration dynamics rather than simple target quality.

## 2026-05-01: Shortlist-Aligned Candidate-Score Regression (`exp8`)

### Motivation

The broad candidate-score regressor still trained on full candidate lists, while the runtime reranker usually only touches a top shortlist.

So the next step was to align everything:

- teacher root scores restricted to the runtime top-`6` shortlist
- candidate features encoded with shortlist count
- runtime reranking using the same shortlist-count semantics

### Dataset

Distilled shortlist export:

- `589` positions
- `3517` candidate samples
- average candidates per position: about `5.98`

Teacher settings:

- teacher: `Variant ML Hybrid`
- move time: `140ms`
- max depth: `5`
- soft-target temperature: `80`
- teacher target top-`K`: `6`
- runtime shortlist top-`K`: `6`

### Offline Result

Models:

- `exp8-candidate-score-linear`
  RMSE `0.1846`, Pearson `0.8553`
- `exp8-candidate-score-mlp256`
  RMSE `0.1661`, Pearson `0.8853`

This was weaker offline than the broader `exp7` regressor, which is expected because it traded dataset size for alignment.

### Online Result

Matched seeds `exp6sl1..exp6sl3`, `60ms`, `3` games per seed per color:

- shortlist-aligned candidate-score regressor, root-only top-`6`, shortlist-count mode, weight `200`
  `0W / 1L / 17D`, score `0.472`

### Interpretation

This experiment tightened the entire loop:

- same shortlist at train time and runtime
- same legal-move-count semantics
- direct teacher root-score supervision

And it still did not produce a live gain.

That is a valuable conclusion:

- we are no longer losing obvious performance to careless train/runtime mismatch
- the next step probably needs richer search-aware ranking targets or different integration objectives, not just more of the same data

## 2026-05-01: Pairwise Move Ranking (`exp9`)

### Motivation

The next question was whether the failure mode was still partly objective mismatch.

Value regression learns position quality.
Listwise policy learns "which move wins this candidate set."
Candidate-score regression learns an absolute move score.

But move ordering is often even simpler:

- prefer move `A` over move `B`

So the next path trained a scalar candidate scorer with a weighted pairwise ranking loss instead of one-hot imitation or pointwise score regression.

### Dataset Variants

Both datasets came from the shortlist-aligned distillation set `exp8`.

Two pairwise constructions were exported:

- `best_vs_rest`
  only compare the teacher-best move against each alternative
- `all_pairs`
  compare every ordered candidate pair

Both used score-gap weighting by default.

Counts:

- `best_vs_rest`
  `2928` total pairs
- `all_pairs`
  `8766` total pairs

### Offline Result

Models:

- `exp9-bestrest-pairwise-mlp256`
  - validation pair accuracy `0.9542`
  - held-out top-1 reconstruction `0.8729`
- `exp9-allpairs-pairwise-mlp256`
  - validation pair accuracy `0.9559`
  - held-out top-1 reconstruction `0.9153`

This was the strongest held-out move-ordering fidelity in the repo so far.

### Online Result

Short tuning family `exp9pa1..exp9pa3`, `60ms`, `2` games per seed per color:

- baseline `Variant ML Hybrid` vs `search`
  `1W / 1L / 10D`, score `0.500`
- `all_pairs`, root-only top-`6`, shortlist-count mode, weight `20`
  `1W / 1L / 10D`, score `0.500`
- `all_pairs`, root-only top-`6`, shortlist-count mode, weight `40`
  `0W / 1L / 11D`, score `0.458`
- `all_pairs`, root-only top-`6`, shortlist-count mode, weight `80`
  `1W / 1L / 10D`, score `0.500`
- `best_vs_rest`, root-only top-`6`, shortlist-count mode, weight `20`
  `3W / 1L / 8D`, score `0.583`

Independent family `exp6sv1..exp6sv4`, `60ms`, `4` games per seed per color:

- baseline `Variant ML Hybrid` vs `search`
  `2W / 3L / 27D`, score `0.484`
- `best_vs_rest`, root-only top-`6`, shortlist-count mode, weight `20`
  `2W / 3L / 27D`, score `0.484`

### Interpretation

This was another important result:

- the pairwise loss clearly improved offline ordering quality
- `all_pairs` generalized best offline
- a `best_vs_rest` model produced the best short-run live spike of this round
- but that spike disappeared on the independent confirmatory seed family

So pairwise ranking improved the modeling story and the offline metrics, but still did not produce a stable online edge.

## 2026-05-01: Probability-Gap Pairwise Weighting (`exp10`)

### Motivation

The previous pairwise run weighted comparisons by teacher score gaps.

That may overemphasize numerically large search-score differences that do not always translate cleanly into better ordering decisions.

So the next variation used:

- `best_vs_rest`
- probability-gap weighting instead of score-gap weighting

### Offline Result

Model:

- `exp10-bestrest-probgap-mlp256`

Validation:

- pair accuracy `0.9542`
- held-out top-1 reconstruction `0.8729`

This landed almost exactly on top of the score-gap `best_vs_rest` run offline.

### Online Result

Short tuning family `exp9pa1..exp9pa3`, `60ms`, `2` games per seed per color:

- `best_vs_rest`, probability-gap weighting, root-only top-`6`, shortlist-count mode, weight `20`
  `0W / 1L / 11D`, score `0.458`

### Interpretation

This was useful because it narrowed the search:

- weighting by score gap versus probability gap did not meaningfully change the offline picture
- and it did not rescue the online result

So the main issue still looks like search integration dynamics, not this specific pair-weight definition
