const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPairWeight,
  createPairwiseRecords,
  resolvePairMode,
  resolveWeightMode,
  summarizePairwiseRecords
} = require("../scripts/pairwise-policy-data.js");

test("resolvePairMode and resolveWeightMode pick stable defaults", () => {
  assert.equal(resolvePairMode({}), "best_vs_rest");
  assert.equal(resolvePairMode({ pairMode: "all_pairs" }), "all_pairs");
  assert.equal(resolveWeightMode({}), "score_gap");
  assert.equal(resolveWeightMode({ weightMode: "probability_gap" }), "probability_gap");
});

test("buildPairWeight can use normalized score gaps", () => {
  const weight = buildPairWeight({
    targetScore: 120,
    targetProbability: 0.7
  }, {
    targetScore: -180,
    targetProbability: 0.1
  }, {
    searchScale: 300,
    minimumWeight: 0.05
  });

  assert.equal(weight > 0.7, true);
  assert.equal(weight <= 1, true);
});

test("createPairwiseRecords builds best-vs-rest pairs from candidate rows", () => {
  const pairs = createPairwiseRecords([
    {
      positionId: "p1",
      move: "e2e4",
      features: [1, 0],
      targetScore: 0,
      targetProbability: 0.6,
      featureEncoding: "canonical",
      rulesKey: "classic",
      source: { ply: 1 }
    },
    {
      positionId: "p1",
      move: "e2e3",
      features: [0, 1],
      targetScore: -50,
      targetProbability: 0.3,
      featureEncoding: "canonical",
      rulesKey: "classic",
      source: { ply: 1 }
    },
    {
      positionId: "p1",
      move: "g1f3",
      features: [0, 0],
      targetScore: -120,
      targetProbability: 0.1,
      featureEncoding: "canonical",
      rulesKey: "classic",
      source: { ply: 1 }
    }
  ], {
    pairMode: "best_vs_rest",
    searchScale: 300,
    minimumWeight: 0.05
  });

  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].betterMove, "e2e4");
  assert.equal(pairs[1].betterMove, "e2e4");
  assert.equal(pairs[0].pairWeight > 0, true);
});

test("summarizePairwiseRecords counts pairs and positions", () => {
  const summary = summarizePairwiseRecords([
    { positionId: "p1", pairWeight: 0.3, rulesKey: "classic" },
    { positionId: "p1", pairWeight: 0.5, rulesKey: "classic" },
    { positionId: "p2", pairWeight: 0.4, rulesKey: "friendlyFire" }
  ]);

  assert.equal(summary.pairCount, 3);
  assert.equal(summary.positionCount, 2);
  assert.equal(summary.meanPairWeight, 0.4);
  assert.equal(summary.byRules.classic.pairCount, 2);
});
