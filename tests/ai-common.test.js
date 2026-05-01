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
});
