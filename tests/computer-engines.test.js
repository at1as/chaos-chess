const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const chess = require("../src/engine.js");
const computer = require("../src/computer-engines.js");
const features = require("../src/position-encoder.js");
const moveFeatures = require("../src/move-encoder.js");

function makeState(pieces, options = {}) {
  return chess.createStateFromPieces(pieces, {
    turn: options.turn || "w",
    rules: options.rules || chess.DEFAULT_RULES,
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });
}

test("heuristic engine captures a hanging queen when it can", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" },
    { color: "b", type: "q", square: "a4" }
  ]);

  assert.deepEqual(computer.chooseHeuristicMove(state, { depth: 1 }), {
    from: chess.algebraicToCoord("a1"),
    to: chess.algebraicToCoord("a4"),
    promotion: null
  });
});

test("heuristic engine chooses a queen promotion by default", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "a7" }
  ]);

  assert.deepEqual(computer.chooseHeuristicMove(state, { depth: 1 }), {
    from: chess.algebraicToCoord("a7"),
    to: chess.algebraicToCoord("a8"),
    promotion: "q"
  });
});

test("search engine avoids a poisoned capture that the heuristic baseline would take", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "q", square: "a1" },
    { color: "b", type: "r", square: "a4" },
    { color: "b", type: "q", square: "a8" }
  ]);

  const heuristicMove = computer.chooseHeuristicMove(state, { depth: 1 });
  const searchMove = computer.chooseSearchMove(state, { maxDepth: 2, moveTime: 1000 });

  assert.deepEqual(heuristicMove, {
    from: chess.algebraicToCoord("a1"),
    to: chess.algebraicToCoord("a4"),
    promotion: null
  });
  assert.notDeepEqual(searchMove, heuristicMove);
});

test("search engine finds a mate in one when it exists", () => {
  const state = makeState([
    { color: "w", type: "k", square: "f6" },
    { color: "w", type: "q", square: "g6" },
    { color: "b", type: "k", square: "h8" }
  ]);

  assert.deepEqual(computer.chooseSearchMove(state, { maxDepth: 2, moveTime: 1000 }), {
    from: chess.algebraicToCoord("g6"),
    to: chess.algebraicToCoord("g7"),
    promotion: null
  });
});

test("searchPosition returns move metadata for pipeline use", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" },
    { color: "b", type: "q", square: "a4" }
  ]);
  const result = computer.searchPosition(state, { maxDepth: 2, moveTime: 1000 });

  assert.deepEqual(result.move, {
    from: chess.algebraicToCoord("a1"),
    to: chess.algebraicToCoord("a4"),
    promotion: null
  });
  assert.equal(typeof result.nodes, "number");
  assert.equal(result.depth >= 1, true);
});

test("searchPosition can expose scored root candidates for distillation", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e2" }
  ]);
  const result = computer.searchPosition(state, {
    maxDepth: 1,
    moveTime: 100,
    includeRootScores: true
  });

  assert.ok(result);
  assert.equal(Array.isArray(result.rootCandidates), true);
  assert.equal(result.rootCandidates.length >= 2, true);
  assert.equal(typeof result.rootCandidates[0].uci, "string");
  assert.equal(typeof result.rootCandidates[0].score, "number");
});

test("rankRootCandidates returns a stable heuristic shortlist", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e2" }
  ]);
  const ranked = computer.rankRootCandidates(state, { topK: 2 });

  assert.equal(Array.isArray(ranked), true);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].score >= ranked[1].score, true);
  assert.equal(typeof ranked[0].uci, "string");
});

test("value-model evaluator flips prediction into the requested perspective", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" }
  ], {
    turn: "b"
  });
  const vector = features.encodeStateVector(state);
  const weights = new Array(vector.length).fill(0);
  const sideToMoveIndex = 12 * 64;
  const evaluator = computer.createValueModelEvaluator({
    modelType: "linear",
    inputSize: vector.length,
    weights,
    bias: -0.5
  }, {
    scoreScale: 600
  });

  weights[sideToMoveIndex] = 1;

  assert.equal(Math.round(evaluator(state, "w")), 330);
  assert.equal(Math.round(evaluator(state, "b")), -330);
});

test("searchPosition accepts a model-backed leaf evaluator", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" },
    { color: "b", type: "q", square: "a4" }
  ]);
  const vector = features.encodeStateVector(state);
  const result = computer.searchPosition(state, {
    maxDepth: 1,
    moveTime: 100,
    valueModel: {
      modelType: "linear",
      inputSize: vector.length,
      weights: new Array(vector.length).fill(0),
      bias: 0
    }
  });

  assert.ok(result);
  assert.ok(result.move);
  assert.equal(typeof result.nodes, "number");
});

test("searchPosition accepts a dense multi-layer value model", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" },
    { color: "b", type: "q", square: "a4" }
  ]);
  const vector = features.encodeStateVector(state);
  const result = computer.searchPosition(state, {
    maxDepth: 1,
    moveTime: 100,
    valueModel: {
      modelType: "dense",
      inputSize: vector.length,
      hiddenSizes: [2, 2],
      layerWeights: [
        [
          (() => {
            const row = new Array(vector.length).fill(0);
            row[0] = 1;
            return row;
          })(),
          (() => {
            const row = new Array(vector.length).fill(0);
            row[1] = 1;
            return row;
          })()
        ],
        [
          [0.5, -0.25],
          [-0.5, 0.25]
        ]
      ],
      layerBiases: [
        [0, 0],
        [0, 0]
      ],
      outputWeights: [1, -1],
      outputBias: 0
    }
  });

  assert.ok(result);
  assert.ok(result.move);
  assert.equal(typeof result.nodes, "number");
});

test("policy-model evaluator scores legal candidates directly", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e2" }
  ]);
  const candidates = computer.expandMoveCandidates(state);
  const preferred = candidates.find((candidate) => (
    candidate.move.from.x === chess.algebraicToCoord("e2").x &&
    candidate.move.to.x === chess.algebraicToCoord("e4").x &&
    candidate.move.to.y === chess.algebraicToCoord("e4").y
  ));
  const other = candidates.find((candidate) => candidate !== preferred);
  const policyVector = moveFeatures.encodeCandidateVector(state, preferred, {
    encoding: "canonical",
    legalMoveCount: candidates.length
  });
  const weights = new Array(policyVector.length).fill(0);
  let index;

  for (index = 0; index < policyVector.length; index += 1) {
    if (policyVector[index] === 1) {
      weights[index] = 0.1;
    }
  }

  const evaluator = computer.createPolicyModelEvaluator({
    modelType: "linear",
    inputSize: policyVector.length,
    weights,
    bias: -0.25,
    featureEncoding: "canonical"
  });

  assert.equal(evaluator(state, preferred, { legalMoveCount: candidates.length }) > evaluator(state, other, { legalMoveCount: candidates.length }), true);
});

test("searchPosition accepts a policy model for candidate ordering", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e2" }
  ]);
  const candidates = computer.expandMoveCandidates(state);
  const preferred = candidates.find((candidate) => moveFeatures.candidateToUci(candidate) === "e2e4");
  const vector = moveFeatures.encodeCandidateVector(state, preferred, {
    encoding: "canonical",
    legalMoveCount: candidates.length
  });
  const weights = vector.map((value) => (value === 1 ? 0.05 : 0));
  const result = computer.searchPosition(state, {
    maxDepth: 1,
    moveTime: 100,
    policyModel: {
      modelType: "linear",
      inputSize: vector.length,
      weights,
      bias: -0.1,
      featureEncoding: "canonical"
    },
    policyWeight: 1000
  });

  assert.ok(result);
  assert.deepEqual(result.move, {
    from: chess.algebraicToCoord("e2"),
    to: chess.algebraicToCoord("e4"),
    promotion: null
  });
});

test("applyPolicyAdjustments can use shortlist softmax and confidence gating", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e2" }
  ]);
  const candidates = computer.expandMoveCandidates(state);
  const preferred = candidates.find((candidate) => moveFeatures.candidateToUci(candidate) === "e2e4");
  const other = candidates.find((candidate) => moveFeatures.candidateToUci(candidate) === "e2e3");
  const scoredCandidates = [
    { candidate: other, score: 0 },
    { candidate: preferred, score: 0 }
  ];

  computer.applyPolicyAdjustments(state, scoredCandidates, candidates.length, {
    policyEvaluator(_state, candidate) {
      return moveFeatures.candidateToUci(candidate) === "e2e4" ? 5 : 0;
    },
    policyWeight: 100,
    policyTopK: 2,
    policyUseSoftmax: true,
    policyConfidenceThreshold: 0.5
  });

  assert.equal(scoredCandidates[0].candidate, preferred);
  assert.equal(scoredCandidates[0].score > scoredCandidates[1].score, true);

  const gatedCandidates = [
    { candidate: other, score: 0 },
    { candidate: preferred, score: 0 }
  ];

  computer.applyPolicyAdjustments(state, gatedCandidates, candidates.length, {
    policyEvaluator(_state, candidate) {
      return moveFeatures.candidateToUci(candidate) === "e2e4" ? 5 : 0;
    },
    policyWeight: 100,
    policyTopK: 2,
    policyUseSoftmax: true,
    policyConfidenceThreshold: 0.99
  });

  assert.equal(gatedCandidates[0].score, 0);
  assert.equal(gatedCandidates[1].score, 0);
});

test("applyPolicyAdjustments can pass shortlist size into policy features", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e2" }
  ]);
  const candidates = computer.expandMoveCandidates(state);
  const scoredCandidates = candidates.slice(0, 2).map((candidate) => ({
    candidate,
    score: 0
  }));
  const seenLegalMoveCounts = [];

  computer.applyPolicyAdjustments(state, scoredCandidates, candidates.length, {
    policyEvaluator(_state, _candidate, options) {
      seenLegalMoveCounts.push(options.legalMoveCount);
      return 0;
    },
    policyWeight: 1,
    policyTopK: 2,
    policyUseShortlistCount: true
  });

  assert.deepEqual(seenLegalMoveCounts, [2, 2]);
});

test("curated variant ML model asset loads in the runtime evaluator", () => {
  const payload = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "assets", "models", "variant-ml-hybrid-v1.json"),
      "utf8"
    )
  );
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "q", square: "d1" },
    { color: "b", type: "q", square: "d8" }
  ], {
    rules: {
      friendlyFire: true,
      kamikaze: false,
      wrapAround: true,
      doubleDirectionPawns: false,
      jumpPawns: true
    }
  });
  const evaluator = computer.createValueModelEvaluator(payload, {
    scoreScale: 600
  });
  const score = evaluator(state, "w");

  assert.equal(Number.isFinite(score), true);
});

test("stockfish adapter returns parsed move coordinates", async () => {
  const adapter = new computer.StockfishAdapter({
    classicEngine: {
      requestBestMove() {
        return Promise.resolve("e2e4");
      },
      init() {
        return Promise.resolve();
      },
      reset() {
        return;
      }
    }
  });

  const move = await adapter.requestMove({
    getUciMoves() {
      return [];
    }
  }, {
    moveTime: 250
  });

  assert.deepEqual(move, {
    from: chess.algebraicToCoord("e2"),
    to: chess.algebraicToCoord("e4"),
    promotion: null
  });
});
