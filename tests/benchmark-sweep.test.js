const test = require("node:test");
const assert = require("node:assert/strict");
const sweep = require("../scripts/benchmark-sweep.js");

test("aggregateColorBalancedPair reports candidate-perspective totals", () => {
  const aggregate = sweep.aggregateColorBalancedPair({
    games: 6,
    whiteWins: 3,
    blackWins: 1,
    draws: 2,
    totalPlies: 180
  }, {
    games: 6,
    whiteWins: 2,
    blackWins: 1,
    draws: 3,
    totalPlies: 210
  });

  assert.deepEqual(aggregate.candidateWhite, {
    games: 6,
    wins: 3,
    losses: 1,
    draws: 2,
    score: (3 + 1) / 6
  });
  assert.deepEqual(aggregate.candidateBlack, {
    games: 6,
    wins: 1,
    losses: 2,
    draws: 3,
    score: (1 + 1.5) / 6
  });
  assert.equal(aggregate.totalGames, 12);
  assert.equal(aggregate.wins, 4);
  assert.equal(aggregate.losses, 3);
  assert.equal(aggregate.draws, 5);
  assert.equal(aggregate.score, (4 + 2.5) / 12);
  assert.equal(aggregate.averagePlies, (180 + 210) / 12);
});

test("parseSeedList trims empty items and falls back to defaults", () => {
  assert.deepEqual(sweep.parseSeedList(" alpha, beta ,, gamma "), ["alpha", "beta", "gamma"]);
  assert.deepEqual(sweep.parseSeedList(""), ["sweep-1", "sweep-2", "sweep-3"]);
});
