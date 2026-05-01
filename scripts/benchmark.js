#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  parseRulesSpec,
  playGame,
  ensureParentDir,
  loadModelPayload
} = require("./ai-common.js");

const args = parseArgs(process.argv.slice(2));
const games = Number(args.games) || 8;
const maxPlies = Number(args["max-plies"]) || 160;
const moveTime = Number(args["move-time"]) || 250;
const maxDepth = args["max-depth"] ? Number(args["max-depth"]) : undefined;
const whiteBot = args.white || "search";
const blackBot = args.black || "heuristic";
const rulesSpec = args.rules || "random";
const outputPath = args.output ? path.resolve(process.cwd(), args.output) : null;
const whiteModelPath = args["white-model"] || args.model || null;
const blackModelPath = args["black-model"] || args.model || null;
const whiteOrderingModelPath = args["white-ordering-model"] || null;
const blackOrderingModelPath = args["black-ordering-model"] || null;
const whiteBlend = args["white-blend"] ? Number(args["white-blend"]) : undefined;
const blackBlend = args["black-blend"] ? Number(args["black-blend"]) : undefined;
const whiteOrderingWeight = args["white-ordering-weight"] ? Number(args["white-ordering-weight"]) : undefined;
const blackOrderingWeight = args["black-ordering-weight"] ? Number(args["black-ordering-weight"]) : undefined;

const summary = {
  games,
  whiteBot,
  blackBot,
  rulesSpec,
  moveTime,
  maxDepth: maxDepth || null,
  maxPlies,
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
    rules: parseRulesSpec(rulesSpec),
    whiteBot,
    blackBot,
    whiteOptions: whiteModelPath || whiteOrderingModelPath ? {
      valueModel: whiteModelPath ? loadModelPayload(whiteModelPath) : undefined,
      orderingValueModel: whiteOrderingModelPath ? loadModelPayload(whiteOrderingModelPath) : undefined,
      modelBlendWeight: whiteBlend,
      orderingWeight: whiteOrderingWeight
    } : undefined,
    blackOptions: blackModelPath || blackOrderingModelPath ? {
      valueModel: blackModelPath ? loadModelPayload(blackModelPath) : undefined,
      orderingValueModel: blackOrderingModelPath ? loadModelPayload(blackOrderingModelPath) : undefined,
      modelBlendWeight: blackBlend,
      orderingWeight: blackOrderingWeight
    } : undefined,
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

if (outputPath) {
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
}

process.stdout.write([
  `Benchmark: ${whiteBot} (White) vs ${blackBot} (Black)`,
  `Games: ${games}`,
  `Rules: ${rulesSpec}`,
  whiteModelPath ? `White model: ${whiteModelPath}` : null,
  blackModelPath ? `Black model: ${blackModelPath}` : null,
  whiteOrderingModelPath ? `White ordering model: ${whiteOrderingModelPath}` : null,
  blackOrderingModelPath ? `Black ordering model: ${blackOrderingModelPath}` : null,
  `White wins: ${summary.whiteWins}`,
  `Black wins: ${summary.blackWins}`,
  `Draws: ${summary.draws}`,
  `Average plies: ${summary.averagePlies.toFixed(1)}`,
  outputPath ? `Saved JSON summary to ${outputPath}` : null
].filter(Boolean).join("\n") + "\n");
