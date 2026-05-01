#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, ensureParentDir } = require("./ai-common.js");
const { buildSideOptions, runBenchmarkSuite } = require("./benchmark.js");

function parseSeedList(rawSeeds) {
  if (!rawSeeds) {
    return ["sweep-1", "sweep-2", "sweep-3"];
  }

  return rawSeeds
    .split(",")
    .map((seed) => seed.trim())
    .filter(Boolean);
}

function aggregateColorBalancedPair(candidateAsWhite, candidateAsBlack) {
  const candidateWhite = {
    games: candidateAsWhite.games,
    wins: candidateAsWhite.whiteWins,
    losses: candidateAsWhite.blackWins,
    draws: candidateAsWhite.draws
  };
  const candidateBlack = {
    games: candidateAsBlack.games,
    wins: candidateAsBlack.blackWins,
    losses: candidateAsBlack.whiteWins,
    draws: candidateAsBlack.draws
  };
  const totalGames = candidateWhite.games + candidateBlack.games;
  const wins = candidateWhite.wins + candidateBlack.wins;
  const losses = candidateWhite.losses + candidateBlack.losses;
  const draws = candidateWhite.draws + candidateBlack.draws;
  const averagePlies = (
    candidateAsWhite.totalPlies +
    candidateAsBlack.totalPlies
  ) / totalGames;

  return {
    totalGames,
    wins,
    losses,
    draws,
    score: (wins + (draws * 0.5)) / totalGames,
    averagePlies,
    candidateWhite: {
      ...candidateWhite,
      score: (candidateWhite.wins + (candidateWhite.draws * 0.5)) / candidateWhite.games
    },
    candidateBlack: {
      ...candidateBlack,
      score: (candidateBlack.wins + (candidateBlack.draws * 0.5)) / candidateBlack.games
    }
  };
}

function runColorBalancedSweep(config) {
  const seeds = parseSeedList(config.seeds);
  const summary = {
    candidateBot: config.candidateBot,
    referenceBot: config.referenceBot,
    rulesSpec: config.rulesSpec,
    moveTime: config.moveTime,
    maxDepth: config.maxDepth || null,
    maxPlies: config.maxPlies,
    gamesPerSeed: config.gamesPerSeed,
    seeds,
    candidateModelPath: config.candidateModelPath || null,
    candidateOrderingModelPath: config.candidateOrderingModelPath || null,
    candidateBlendWeight: config.candidateBlendWeight === undefined ? null : config.candidateBlendWeight,
    candidateOrderingWeight: config.candidateOrderingWeight === undefined ? null : config.candidateOrderingWeight,
    referenceModelPath: config.referenceModelPath || null,
    referenceOrderingModelPath: config.referenceOrderingModelPath || null,
    referenceBlendWeight: config.referenceBlendWeight === undefined ? null : config.referenceBlendWeight,
    referenceOrderingWeight: config.referenceOrderingWeight === undefined ? null : config.referenceOrderingWeight,
    perSeed: [],
    totals: {
      totalGames: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      totalPlies: 0,
      candidateWhiteGames: 0,
      candidateWhiteWins: 0,
      candidateWhiteLosses: 0,
      candidateWhiteDraws: 0,
      candidateBlackGames: 0,
      candidateBlackWins: 0,
      candidateBlackLosses: 0,
      candidateBlackDraws: 0
    }
  };
  const candidateOptions = buildSideOptions({
    valueModelPath: config.candidateModelPath,
    orderingValueModelPath: config.candidateOrderingModelPath,
    modelBlendWeight: config.candidateBlendWeight,
    orderingWeight: config.candidateOrderingWeight
  });
  const referenceOptions = buildSideOptions({
    valueModelPath: config.referenceModelPath,
    orderingValueModelPath: config.referenceOrderingModelPath,
    modelBlendWeight: config.referenceBlendWeight,
    orderingWeight: config.referenceOrderingWeight
  });

  for (const seed of seeds) {
    const candidateAsWhite = runBenchmarkSuite({
      games: config.gamesPerSeed,
      maxPlies: config.maxPlies,
      moveTime: config.moveTime,
      maxDepth: config.maxDepth,
      whiteBot: config.candidateBot,
      blackBot: config.referenceBot,
      rulesSpec: config.rulesSpec,
      seed,
      whiteOptions: candidateOptions,
      blackOptions: referenceOptions
    });
    const candidateAsBlack = runBenchmarkSuite({
      games: config.gamesPerSeed,
      maxPlies: config.maxPlies,
      moveTime: config.moveTime,
      maxDepth: config.maxDepth,
      whiteBot: config.referenceBot,
      blackBot: config.candidateBot,
      rulesSpec: config.rulesSpec,
      seed,
      whiteOptions: referenceOptions,
      blackOptions: candidateOptions
    });
    const aggregate = aggregateColorBalancedPair(candidateAsWhite, candidateAsBlack);

    summary.perSeed.push({
      seed,
      aggregate,
      candidateAsWhite,
      candidateAsBlack
    });

    summary.totals.totalGames += aggregate.totalGames;
    summary.totals.wins += aggregate.wins;
    summary.totals.losses += aggregate.losses;
    summary.totals.draws += aggregate.draws;
    summary.totals.totalPlies += candidateAsWhite.totalPlies + candidateAsBlack.totalPlies;
    summary.totals.candidateWhiteGames += aggregate.candidateWhite.games;
    summary.totals.candidateWhiteWins += aggregate.candidateWhite.wins;
    summary.totals.candidateWhiteLosses += aggregate.candidateWhite.losses;
    summary.totals.candidateWhiteDraws += aggregate.candidateWhite.draws;
    summary.totals.candidateBlackGames += aggregate.candidateBlack.games;
    summary.totals.candidateBlackWins += aggregate.candidateBlack.wins;
    summary.totals.candidateBlackLosses += aggregate.candidateBlack.losses;
    summary.totals.candidateBlackDraws += aggregate.candidateBlack.draws;
  }

  summary.totals.score = (
    summary.totals.wins +
    (summary.totals.draws * 0.5)
  ) / summary.totals.totalGames;
  summary.totals.averagePlies = summary.totals.totalPlies / summary.totals.totalGames;
  summary.totals.candidateWhiteScore = (
    summary.totals.candidateWhiteWins +
    (summary.totals.candidateWhiteDraws * 0.5)
  ) / summary.totals.candidateWhiteGames;
  summary.totals.candidateBlackScore = (
    summary.totals.candidateBlackWins +
    (summary.totals.candidateBlackDraws * 0.5)
  ) / summary.totals.candidateBlackGames;

  return summary;
}

function formatSweepSummary(summary) {
  return [
    `Color-balanced sweep: ${summary.candidateBot} vs ${summary.referenceBot}`,
    `Seeds: ${summary.seeds.join(", ")}`,
    `Games per seed per color: ${summary.gamesPerSeed}`,
    `Rules: ${summary.rulesSpec}`,
    `Move time: ${summary.moveTime} ms`,
    `Candidate wins: ${summary.totals.wins}`,
    `Reference wins: ${summary.totals.losses}`,
    `Draws: ${summary.totals.draws}`,
    `Candidate score: ${summary.totals.score.toFixed(3)}`,
    `Candidate as White score: ${summary.totals.candidateWhiteScore.toFixed(3)}`,
    `Candidate as Black score: ${summary.totals.candidateBlackScore.toFixed(3)}`,
    `Average plies: ${summary.totals.averagePlies.toFixed(1)}`
  ].join("\n");
}

function main(argv) {
  const args = parseArgs(argv);
  const summary = runColorBalancedSweep({
    candidateBot: args.candidate || "hybrid",
    referenceBot: args.reference || "search",
    rulesSpec: args.rules || "random",
    moveTime: Number(args["move-time"]) || 250,
    maxDepth: args["max-depth"] ? Number(args["max-depth"]) : undefined,
    maxPlies: Number(args["max-plies"]) || 160,
    gamesPerSeed: Number(args["games-per-seed"]) || 8,
    seeds: args.seeds,
    candidateModelPath: args["candidate-model"] || args.model || null,
    candidateOrderingModelPath: args["candidate-ordering-model"] || null,
    candidateBlendWeight: args["candidate-blend"] ? Number(args["candidate-blend"]) : undefined,
    candidateOrderingWeight: args["candidate-ordering-weight"] ? Number(args["candidate-ordering-weight"]) : undefined,
    referenceModelPath: args["reference-model"] || null,
    referenceOrderingModelPath: args["reference-ordering-model"] || null,
    referenceBlendWeight: args["reference-blend"] ? Number(args["reference-blend"]) : undefined,
    referenceOrderingWeight: args["reference-ordering-weight"] ? Number(args["reference-ordering-weight"]) : undefined
  });
  const outputPath = args.output ? path.resolve(process.cwd(), args.output) : null;

  if (outputPath) {
    ensureParentDir(outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  }

  process.stdout.write(
    formatSweepSummary(summary) +
    (outputPath ? `\nSaved JSON summary to ${outputPath}` : "") +
    "\n"
  );
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  aggregateColorBalancedPair,
  formatSweepSummary,
  parseSeedList,
  runColorBalancedSweep
};
