#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  parseRulesSpec,
  playGame,
  ensureParentDir
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
  `White wins: ${summary.whiteWins}`,
  `Black wins: ${summary.blackWins}`,
  `Draws: ${summary.draws}`,
  `Average plies: ${summary.averagePlies.toFixed(1)}`,
  outputPath ? `Saved JSON summary to ${outputPath}` : null
].filter(Boolean).join("\n") + "\n");
