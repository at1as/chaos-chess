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

test("deriveValueTarget can use teacherScore instead of searchScore", () => {
  const target = mlData.deriveValueTarget({
    searchScore: -600,
    teacherScore: 600,
    outcome: 0
  }, {
    scoreField: "teacherScore",
    searchScale: 600,
    searchWeight: 1,
    outcomeWeight: 0
  });

  assert.equal(Number(target.toFixed(6)), Number(Math.tanh(1).toFixed(6)));
});

test("rulesKeyFromRules returns a stable ruleset key", () => {
  assert.equal(mlData.rulesKeyFromRules({}), "classic");
  assert.equal(mlData.rulesKeyFromRules({
    friendlyFire: true,
    jumpPawns: true
  }), "friendlyFire+jumpPawns");
});

test("prepareTrainingRecord records the chosen score field in source metadata", () => {
  const record = mlData.prepareTrainingRecord({
    featureVector: [0, 1],
    teacherScore: 300,
    searchScore: -300,
    outcome: 1,
    rules: {}
  }, {
    scoreField: "teacherScore",
    searchScale: 600,
    searchWeight: 1,
    outcomeWeight: 0
  });

  assert.equal(record.source.scoreField, "teacherScore");
  assert.equal(record.searchValue > 0, true);
});
