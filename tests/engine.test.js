const test = require("node:test");
const assert = require("node:assert/strict");
const chess = require("../src/engine.js");

function moveTargets(state, square) {
  const coord = chess.algebraicToCoord(square);
  return chess.getLegalMoves(state, coord.x, coord.y).map((move) => chess.coordToAlgebraic(move.to.x, move.to.y)).sort();
}

test("friendly fire allows allied captures except against the allied king", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" },
    { color: "w", type: "p", square: "a2" }
  ], {
    rules: { friendlyFire: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.deepEqual(moveTargets(state, "a1"), ["a2", "b1", "c1", "d1"]);

  const kingBlockState = chess.createStateFromPieces([
    { color: "w", type: "k", square: "a2" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" }
  ], {
    rules: { friendlyFire: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.ok(!moveTargets(kingBlockState, "a1").includes("a2"));
});

test("kamikaze captures remove both pieces and leave the destination empty", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" },
    { color: "b", type: "n", square: "a4" }
  ], {
    rules: { kamikaze: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  const coord = chess.algebraicToCoord("a1");
  const captureMove = chess.getLegalMoves(state, coord.x, coord.y).find((move) => chess.coordToAlgebraic(move.to.x, move.to.y) === "a4");
  const nextState = chess.applyMove(state, captureMove);

  assert.equal(nextState.board[chess.algebraicToCoord("a1").y * 8 + chess.algebraicToCoord("a1").x], null);
  assert.equal(nextState.board[chess.algebraicToCoord("a4").y * 8 + chess.algebraicToCoord("a4").x], null);
});

test("kings may not make kamikaze captures", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "b", type: "p", square: "e2" }
  ], {
    rules: { kamikaze: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.ok(!moveTargets(state, "e1").includes("e2"));
});

test("wrap-around movement exists, but checks do not cross the wrap seam", () => {
  const movingState = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "r", square: "a1" }
  ], {
    rules: { wrapAround: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.ok(moveTargets(movingState, "a1").includes("h1"));

  const checkState = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "h1" },
    { color: "w", type: "r", square: "a1" }
  ], {
    rules: { wrapAround: true },
    turn: "b",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.equal(chess.isInCheck(checkState, "b"), false);
});

test("double-direction pawns may move and capture backward", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e4" },
    { color: "b", type: "n", square: "d5" },
    { color: "b", type: "b", square: "d3" }
  ], {
    rules: { doubleDirectionPawns: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.deepEqual(moveTargets(state, "e4"), ["d3", "d5", "e3", "e5"]);
});

test("jump pawns always keep their one- and two-step options when clear", () => {
  const state = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "e4" }
  ], {
    rules: { jumpPawns: true },
    turn: "w",
    castlingRights: {
      w: { k: false, q: false },
      b: { k: false, q: false }
    }
  });

  assert.deepEqual(moveTargets(state, "e4"), ["e5", "e6"]);
});

test("standard pawns still keep their opening two-step without jump pawns enabled", () => {
  const state = chess.createState();
  assert.deepEqual(moveTargets(state, "e2"), ["e3", "e4"]);
});

test("moveToUci appends the promotion suffix when needed", () => {
  assert.equal(chess.moveToUci({
    from: { x: 0, y: 1 },
    to: { x: 0, y: 0 },
    piece: { color: "w", type: "p" }
  }, "q"), "a7a8q");
});

test("ChessGame tracks UCI history and restores it on undo", () => {
  const game = new chess.ChessGame(chess.DEFAULT_RULES);

  assert.equal(game.move(4, 6, 4, 4).ok, true);
  assert.equal(game.move(4, 1, 4, 3).ok, true);
  assert.deepEqual(game.getUciMoves(), ["e2e4", "e7e5"]);

  assert.equal(game.undo(), true);
  assert.deepEqual(game.getUciMoves(), ["e2e4"]);
});
