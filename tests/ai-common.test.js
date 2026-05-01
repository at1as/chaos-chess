const test = require("node:test");
const assert = require("node:assert/strict");
const aiCommon = require("../scripts/ai-common.js");

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
