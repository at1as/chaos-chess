const test = require("node:test");
const assert = require("node:assert/strict");
const mlData = require("../scripts/ml-data.js");

test("normalizeSearchScore squashes large search values into [-1, 1]", () => {
  assert.equal(mlData.normalizeSearchScore(0, 600), 0);
  assert.equal(mlData.normalizeSearchScore(null, 600), null);
  assert.equal(mlData.normalizeSearchScore(1000000, 600) <= 1, true);
  assert.equal(mlData.normalizeSearchScore(1000000, 600) > 0.99, true);
  assert.equal(mlData.normalizeSearchScore(-1000000, 600) >= -1, true);
  assert.equal(mlData.normalizeSearchScore(-1000000, 600) < -0.99, true);
});

test("deriveValueTarget blends search score and outcome", () => {
  const target = mlData.deriveValueTarget({
    searchScore: 600,
    outcome: 1
  }, {
    searchScale: 600,
    searchWeight: 0.7,
    outcomeWeight: 0.3
  });

  assert.equal(Number(target.toFixed(6)), Number(((Math.tanh(1) * 0.7) + 0.3).toFixed(6)));
});

test("deriveValueTarget falls back to outcome when no search score exists", () => {
  assert.equal(mlData.deriveValueTarget({
    searchScore: null,
    outcome: -1
  }, {
    searchScale: 600,
    searchWeight: 0.7,
    outcomeWeight: 0.3
  }), -1);
});

test("rulesKeyFromRules returns a stable ruleset key", () => {
  assert.equal(mlData.rulesKeyFromRules({}), "classic");
  assert.equal(mlData.rulesKeyFromRules({
    friendlyFire: true,
    jumpPawns: true
  }), "friendlyFire+jumpPawns");
});
