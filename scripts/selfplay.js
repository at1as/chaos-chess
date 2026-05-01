#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  parseRulesSpec,
  playGame,
  ensureParentDir,
  featureSchema
} = require("./ai-common.js");

const args = parseArgs(process.argv.slice(2));
const games = Number(args.games) || 4;
const maxPlies = Number(args["max-plies"]) || 160;
const moveTime = Number(args["move-time"]) || 250;
const maxDepth = args["max-depth"] ? Number(args["max-depth"]) : undefined;
const whiteBot = args.white || "search";
const blackBot = args.black || "search";
const rulesSpec = args.rules || "random";
const outputPath = path.resolve(process.cwd(), args.output || "ml/datasets/selfplay.jsonl");
const metadataPath = path.resolve(process.cwd(), args.metadata || "ml/datasets/selfplay.metadata.json");

ensureParentDir(outputPath);
ensureParentDir(metadataPath);

const output = fs.createWriteStream(outputPath, { encoding: "utf8" });
const summaries = [];

for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  const rules = parseRulesSpec(rulesSpec);
  const result = playGame({
    gameId: `selfplay-${gameIndex + 1}`,
    rules,
    whiteBot,
    blackBot,
    moveTime,
    maxDepth,
    maxPlies
  });

  summaries.push(result.summary);

  for (const sample of result.samples) {
    output.write(JSON.stringify(sample) + "\n");
  }
}

output.end();

fs.writeFileSync(metadataPath, JSON.stringify({
  format: "chaos-chess-selfplay-v1",
  generatedAt: new Date().toISOString(),
  games,
  whiteBot,
  blackBot,
  moveTime,
  maxDepth: maxDepth || null,
  maxPlies,
  rulesSpec,
  featureSchema: featureSchema(),
  summaries
}, null, 2));

process.stdout.write([
  `Wrote ${games} self-play games to ${outputPath}`,
  `Metadata: ${metadataPath}`,
  `Bots: white=${whiteBot}, black=${blackBot}`,
  `Rules: ${rulesSpec}`,
  `Move time: ${moveTime}ms`
].join("\n") + "\n");
