#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  parseRulesSpec,
  playGame,
  ensureParentDir,
  loadModelPayload,
  createSeededRandom
} = require("./ai-common.js");

function buildSideOptions(config = {}) {
  if (
    !config.valueModelPath &&
    !config.orderingValueModelPath &&
    !config.policyModelPath &&
    config.modelBlendWeight === undefined &&
    config.orderingWeight === undefined &&
    config.policyWeight === undefined &&
    config.policyMaxPly === undefined
  ) {
    return undefined;
  }

  return {
    valueModel: config.valueModelPath ? loadModelPayload(config.valueModelPath) : undefined,
    orderingValueModel: config.orderingValueModelPath ? loadModelPayload(config.orderingValueModelPath) : undefined,
    policyModel: config.policyModelPath ? loadModelPayload(config.policyModelPath) : undefined,
    modelBlendWeight: config.modelBlendWeight,
    orderingWeight: config.orderingWeight,
    policyWeight: config.policyWeight,
    policyMaxPly: config.policyMaxPly
  };
}

function runBenchmarkSuite(config) {
  const games = Number(config.games) || 8;
  const maxPlies = Number(config.maxPlies) || 160;
  const moveTime = Number(config.moveTime) || 250;
  const maxDepth = config.maxDepth !== undefined ? Number(config.maxDepth) : undefined;
  const whiteBot = config.whiteBot || "search";
  const blackBot = config.blackBot || "heuristic";
  const rulesSpec = config.rulesSpec || "random";
  const seed = config.seed || "chaos-chess-benchmark";
  const randomFn = typeof config.randomFn === "function"
    ? config.randomFn
    : createSeededRandom(seed);
  const summary = {
    games,
    whiteBot,
    blackBot,
    rulesSpec,
    moveTime,
    maxDepth: maxDepth || null,
    maxPlies,
    seed,
    whiteWins: 0,
    blackWins: 0,
    draws: 0,
    totalPlies: 0,
    byStatus: {},
    gameSummaries: []
  };

  for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
    const result = playGame({
      gameId: `benchmark-${gameIndex + 1}`,
      rules: parseRulesSpec(rulesSpec, randomFn),
      whiteBot,
      blackBot,
      randomFn,
      whiteOptions: config.whiteOptions,
      blackOptions: config.blackOptions,
      moveTime,
      maxDepth,
      maxPlies
    });

    summary.gameSummaries.push(result.summary);
    summary.totalPlies += result.summary.plies;
    summary.byStatus[result.summary.status] = (summary.byStatus[result.summary.status] || 0) + 1;

    if (result.summary.winner === "w") {
      summary.whiteWins += 1;
    } else if (result.summary.winner === "b") {
      summary.blackWins += 1;
    } else {
      summary.draws += 1;
    }
  }

  summary.averagePlies = summary.totalPlies / games;
  return summary;
}

function main(argv) {
  const args = parseArgs(argv);
  const outputPath = args.output ? path.resolve(process.cwd(), args.output) : null;
  const summary = runBenchmarkSuite({
    games: args.games,
    maxPlies: args["max-plies"],
    moveTime: args["move-time"],
    maxDepth: args["max-depth"],
    whiteBot: args.white || "search",
    blackBot: args.black || "heuristic",
    rulesSpec: args.rules || "random",
    seed: args.seed || "chaos-chess-benchmark",
    whiteOptions: buildSideOptions({
      valueModelPath: args["white-model"] || args.model || null,
      orderingValueModelPath: args["white-ordering-model"] || null,
      policyModelPath: args["white-policy-model"] || null,
      modelBlendWeight: args["white-blend"] ? Number(args["white-blend"]) : undefined,
      orderingWeight: args["white-ordering-weight"] ? Number(args["white-ordering-weight"]) : undefined,
      policyWeight: args["white-policy-weight"] ? Number(args["white-policy-weight"]) : undefined,
      policyMaxPly: args["white-policy-max-ply"] ? Number(args["white-policy-max-ply"]) : undefined
    }),
    blackOptions: buildSideOptions({
      valueModelPath: args["black-model"] || args.model || null,
      orderingValueModelPath: args["black-ordering-model"] || null,
      policyModelPath: args["black-policy-model"] || null,
      modelBlendWeight: args["black-blend"] ? Number(args["black-blend"]) : undefined,
      orderingWeight: args["black-ordering-weight"] ? Number(args["black-ordering-weight"]) : undefined,
      policyWeight: args["black-policy-weight"] ? Number(args["black-policy-weight"]) : undefined,
      policyMaxPly: args["black-policy-max-ply"] ? Number(args["black-policy-max-ply"]) : undefined
    })
  });

  if (outputPath) {
    ensureParentDir(outputPath);
    fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  }

  process.stdout.write([
    `Benchmark: ${summary.whiteBot} (White) vs ${summary.blackBot} (Black)`,
    `Games: ${summary.games}`,
    `Rules: ${summary.rulesSpec}`,
    `Seed: ${summary.seed}`,
    `White wins: ${summary.whiteWins}`,
    `Black wins: ${summary.blackWins}`,
    `Draws: ${summary.draws}`,
    `Average plies: ${summary.averagePlies.toFixed(1)}`,
    outputPath ? `Saved JSON summary to ${outputPath}` : null
  ].filter(Boolean).join("\n") + "\n");
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  buildSideOptions,
  runBenchmarkSuite
};
