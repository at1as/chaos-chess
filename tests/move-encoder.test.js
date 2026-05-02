const test = require("node:test");
const assert = require("node:assert/strict");
const chess = require("../src/engine.js");
const computer = require("../src/computer-engines.js");
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

test("candidateToUci includes promotion choices", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "a7" }
  ]);
  const candidate = computer.expandMoveCandidates(state).find((entry) => entry.promotion === "n");

  assert.equal(moveFeatures.candidateToUci(candidate), "a7a8n");
});

test("encodeCandidateVector matches the declared feature schema", () => {
  const state = makeState([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "n", square: "f3" },
    { color: "b", type: "p", square: "e5" }
  ]);
  const candidate = computer.expandMoveCandidates(state).find((entry) => moveFeatures.candidateToUci(entry) === "f3e5");
  const vector = moveFeatures.encodeCandidateVector(state, candidate, {
    encoding: "canonical",
    legalMoveCount: computer.expandMoveCandidates(state).length
  });
  const schema = moveFeatures.featureSchema({ encoding: "canonical" });

  assert.equal(vector.length, schema.vectorLength);
  assert.equal(vector.some((value) => value !== 0), true);
});
