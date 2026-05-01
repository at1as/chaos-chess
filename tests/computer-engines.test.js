const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const chess = require("../src/engine.js");
const computer = require("../src/computer-engines.js");
const features = require("../src/position-encoder.js");

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
