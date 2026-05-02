const test = require("node:test");
const assert = require("node:assert/strict");
const aiCommon = require("../scripts/ai-common.js");
const chess = require("../src/engine.js");

test("parseRulesSpec with a seeded random generator is reproducible", () => {
  const leftRandom = aiCommon.createSeededRandom("bench-seed");
  const rightRandom = aiCommon.createSeededRandom("bench-seed");
  const left = [];
  const right = [];

  for (let index = 0; index < 6; index += 1) {
    left.push(aiCommon.parseRulesSpec("random", leftRandom));
    right.push(aiCommon.parseRulesSpec("random", rightRandom));
  }

  assert.deepEqual(left, right);
});

test("playGame can attach teacher search labels to samples", () => {
  const result = aiCommon.playGame({
    gameId: "teacher-smoke",
    rules: chess.DEFAULT_RULES,
    whiteBot: "heuristic",
    blackBot: "heuristic",
    teacherBot: "search",
    teacherOptions: {
      moveTime: 40,
      maxDepth: 1
    },
    moveTime: 40,
    maxDepth: 1,
    maxPlies: 1
  });

  assert.equal(result.samples.length, 1);
  assert.equal(result.samples[0].teacherEngine, "search");
  assert.equal(typeof result.samples[0].teacherScore, "number");
  assert.equal(typeof result.samples[0].teacherMove, "string");
  assert.equal(Array.isArray(result.samples[0].stateSnapshot.board), true);
  assert.equal(result.samples[0].stateSnapshot.board.length, 64);
});

test("serializeState and restoreState preserve a playable engine state", () => {
  const original = chess.createStateFromPieces([
    { color: "w", type: "k", square: "e1" },
    { color: "b", type: "k", square: "e8" },
    { color: "w", type: "p", square: "d5" },
    { color: "b", type: "p", square: "e5" }
  ], {
    turn: "w",
    rules: {
      friendlyFire: true,
      kamikaze: false,
      wrapAround: true,
      doubleDirectionPawns: false,
      jumpPawns: true
    }
  });
  const restored = aiCommon.restoreState(aiCommon.serializeState(original));

  assert.deepEqual(restored.rules, original.rules);
  assert.equal(restored.turn, original.turn);
  assert.equal(restored.board.length, 64);
  assert.equal(chess.getAllLegalMoves(restored).length > 0, true);
});
