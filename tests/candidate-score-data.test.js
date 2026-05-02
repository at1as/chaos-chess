const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCandidateScoreRecord,
  resolveScoreField,
  summarizeCandidateScoreRecords
} = require("../scripts/candidate-score-data.js");

test("createCandidateScoreRecord normalizes candidate deltas into targetValue", () => {
  const record = createCandidateScoreRecord({
    features: [0, 1, 0],
    featureEncoding: "canonical",
    targetScoreDelta: -300,
    isTeacherBest: 0,
    positionId: "g1:12",
    move: "e2e4",
    rules: {
      friendlyFire: true
    },
    source: {
      gameId: "g1",
      ply: 12
    }
  }, {
    scoreField: "targetScoreDelta",
    searchScale: 300
  });

  assert.ok(record);
  assert.equal(record.featureEncoding, "canonical");
  assert.equal(record.rulesKey, "friendlyFire");
  assert.equal(record.positionId, "g1:12");
  assert.equal(record.move, "e2e4");
  assert.equal(record.targetValue < 0, true);
  assert.equal(record.source.scoreField, "targetScoreDelta");
});

test("resolveScoreField defaults candidate regression to score deltas", () => {
  assert.equal(resolveScoreField({}), "targetScoreDelta");
  assert.equal(resolveScoreField({ scoreField: "targetScore" }), "targetScore");
});

test("summarizeCandidateScoreRecords tracks positions and teacher-best rate", () => {
  const summary = summarizeCandidateScoreRecords([
    {
      targetValue: 0,
      rulesKey: "classic",
      positionId: "p1",
      isTeacherBest: 1
    },
    {
      targetValue: -0.5,
      rulesKey: "classic",
      positionId: "p1",
      isTeacherBest: 0
    },
    {
      targetValue: 0,
      rulesKey: "friendlyFire",
      positionId: "p2",
      isTeacherBest: 1
    }
  ]);

  assert.equal(summary.sampleCount, 3);
  assert.equal(summary.positionCount, 2);
  assert.equal(summary.teacherBestCount, 2);
  assert.equal(summary.teacherBestRate, 0.666667);
  assert.equal(summary.byRules.classic.sampleCount, 2);
});
