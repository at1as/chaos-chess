#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  parseRulesSpec,
  playGame,
  ensureParentDir,
  featureSchema,
  loadModelPayload,
  createSeededRandom
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
const featureEncoding = args.encoding === "canonical" ? "canonical" : "absolute";
const whiteModelPath = args["white-model"] || args.model || null;
const blackModelPath = args["black-model"] || args.model || null;
const whiteOrderingModelPath = args["white-ordering-model"] || null;
const blackOrderingModelPath = args["black-ordering-model"] || null;
const whiteBlend = args["white-blend"] ? Number(args["white-blend"]) : undefined;
const blackBlend = args["black-blend"] ? Number(args["black-blend"]) : undefined;
const whiteOrderingWeight = args["white-ordering-weight"] ? Number(args["white-ordering-weight"]) : undefined;
const blackOrderingWeight = args["black-ordering-weight"] ? Number(args["black-ordering-weight"]) : undefined;
const teacherBot = args.teacher || null;
const teacherModelPath = args["teacher-model"] || null;
const teacherOrderingModelPath = args["teacher-ordering-model"] || null;
const teacherBlend = args["teacher-blend"] ? Number(args["teacher-blend"]) : undefined;
const teacherOrderingWeight = args["teacher-ordering-weight"] ? Number(args["teacher-ordering-weight"]) : undefined;
const teacherMoveTime = args["teacher-move-time"] ? Number(args["teacher-move-time"]) : moveTime;
const teacherMaxDepth = args["teacher-max-depth"] ? Number(args["teacher-max-depth"]) : maxDepth;
const seed = args.seed || "chaos-chess-selfplay";
const randomFn = createSeededRandom(seed);

ensureParentDir(outputPath);
ensureParentDir(metadataPath);

const output = fs.createWriteStream(outputPath, { encoding: "utf8" });
const summaries = [];

for (let gameIndex = 0; gameIndex < games; gameIndex += 1) {
  const rules = parseRulesSpec(rulesSpec, randomFn);
  const result = playGame({
    gameId: `selfplay-${gameIndex + 1}`,
    rules,
    whiteBot,
    blackBot,
    featureEncoding,
    randomFn,
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
    teacherBot,
    teacherOptions: teacherBot ? {
      valueModel: teacherModelPath ? loadModelPayload(teacherModelPath) : undefined,
      orderingValueModel: teacherOrderingModelPath ? loadModelPayload(teacherOrderingModelPath) : undefined,
      modelBlendWeight: teacherBlend,
      orderingWeight: teacherOrderingWeight,
      moveTime: teacherMoveTime,
      maxDepth: teacherMaxDepth
    } : undefined,
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
  whiteModelPath,
  blackModelPath,
  whiteOrderingModelPath,
  blackOrderingModelPath,
  whiteBlend: Number.isFinite(whiteBlend) ? whiteBlend : null,
  blackBlend: Number.isFinite(blackBlend) ? blackBlend : null,
  whiteOrderingWeight: Number.isFinite(whiteOrderingWeight) ? whiteOrderingWeight : null,
  blackOrderingWeight: Number.isFinite(blackOrderingWeight) ? blackOrderingWeight : null,
  teacherBot,
  teacherModelPath,
  teacherOrderingModelPath,
  teacherBlend: Number.isFinite(teacherBlend) ? teacherBlend : null,
  teacherOrderingWeight: Number.isFinite(teacherOrderingWeight) ? teacherOrderingWeight : null,
  teacherMoveTime,
  teacherMaxDepth: teacherMaxDepth || null,
  featureEncoding,
  seed,
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
  whiteModelPath ? `White model: ${whiteModelPath}` : null,
  blackModelPath ? `Black model: ${blackModelPath}` : null,
  whiteOrderingModelPath ? `White ordering model: ${whiteOrderingModelPath}` : null,
  blackOrderingModelPath ? `Black ordering model: ${blackOrderingModelPath}` : null,
  teacherBot ? `Teacher bot: ${teacherBot}` : null,
  teacherModelPath ? `Teacher model: ${teacherModelPath}` : null,
  teacherOrderingModelPath ? `Teacher ordering model: ${teacherOrderingModelPath}` : null,
  `Feature encoding: ${featureEncoding}`,
  `Seed: ${seed}`,
  `Rules: ${rulesSpec}`,
  `Move time: ${moveTime}ms`
].join("\n") + "\n");
