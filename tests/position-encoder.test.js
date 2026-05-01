const test = require("node:test");
const assert = require("node:assert/strict");
const chess = require("../src/engine.js");
const features = require("../src/position-encoder.js");

test("position encoder exports the expected flat vector size", () => {
  const vector = features.encodeStateVector(chess.createState());

  assert.equal(vector.length, 842);
});

test("position encoder marks pieces, en passant, and rule flags", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "a2" },
    { color: "b", type: "q", square: "h7" }
  ], {
    rules: { friendlyFire: true, wrapAround: true },
    turn: "b",
    castlingRights: {
      w: { k: true, q: false },
      b: { k: false, q: true }
    },
    enPassant: {
      x: 2,
      y: 2,
      pawnX: 2,
      pawnY: 3,
      color: "w"
    }
  });
  const encoded = features.encodeState(state);
  const wpPlane = encoded.piecePlanes[0];
  const bqPlane = encoded.piecePlanes[10];

  assert.equal(wpPlane[(6 * 8) + 0], 1);
  assert.equal(bqPlane[(1 * 8) + 7], 1);
  assert.deepEqual(encoded.castlingRights, [1, 0, 0, 1]);
  assert.equal(encoded.enPassantPlane[(2 * 8) + 2], 1);
  assert.deepEqual(encoded.ruleFlags, [1, 0, 1, 0, 0]);
});

test("canonical encoder rotates black-to-move positions into side-to-move perspective", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "b", type: "p", square: "a7" },
    { color: "w", type: "q", square: "h2" }
  ], {
    turn: "b",
    castlingRights: {
      w: { k: true, q: false },
      b: { k: false, q: true }
    }
  });
  const encoded = features.encodeCanonicalState(state);
  const selfPawnPlane = encoded.piecePlanes[0];
  const opponentQueenPlane = encoded.piecePlanes[10];

  assert.equal(selfPawnPlane[(6 * 8) + 7], 1);
  assert.equal(opponentQueenPlane[(1 * 8) + 0], 1);
  assert.equal(encoded.sideToMove, "self");
  assert.deepEqual(encoded.castlingRights, [0, 1, 1, 0]);
});
