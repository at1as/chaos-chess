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
const gamePrefix = args["game-prefix"] || "selfplay";
const featureEncoding = args.encoding === "canonical" ? "canonical" : "absolute";
const whiteModelPath = args["white-model"] || args.model || null;
const blackModelPath = args["black-model"] || args.model || null;
const whiteOrderingModelPath = args["white-ordering-model"] || null;
const blackOrderingModelPath = args["black-ordering-model"] || null;
const whitePolicyModelPath = args["white-policy-model"] || null;
const blackPolicyModelPath = args["black-policy-model"] || null;
const whiteBlend = args["white-blend"] ? Number(args["white-blend"]) : undefined;
const blackBlend = args["black-blend"] ? Number(args["black-blend"]) : undefined;
const whiteOrderingWeight = args["white-ordering-weight"] ? Number(args["white-ordering-weight"]) : undefined;
const blackOrderingWeight = args["black-ordering-weight"] ? Number(args["black-ordering-weight"]) : undefined;
const whitePolicyWeight = args["white-policy-weight"] ? Number(args["white-policy-weight"]) : undefined;
const blackPolicyWeight = args["black-policy-weight"] ? Number(args["black-policy-weight"]) : undefined;
const whitePolicyMaxPly = args["white-policy-max-ply"] ? Number(args["white-policy-max-ply"]) : undefined;
const blackPolicyMaxPly = args["black-policy-max-ply"] ? Number(args["black-policy-max-ply"]) : undefined;
const teacherBot = args.teacher || null;
const teacherModelPath = args["teacher-model"] || null;
const teacherOrderingModelPath = args["teacher-ordering-model"] || null;
const teacherPolicyModelPath = args["teacher-policy-model"] || null;
const teacherBlend = args["teacher-blend"] ? Number(args["teacher-blend"]) : undefined;
const teacherOrderingWeight = args["teacher-ordering-weight"] ? Number(args["teacher-ordering-weight"]) : undefined;
const teacherPolicyWeight = args["teacher-policy-weight"] ? Number(args["teacher-policy-weight"]) : undefined;
const teacherPolicyMaxPly = args["teacher-policy-max-ply"] ? Number(args["teacher-policy-max-ply"]) : undefined;
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
    gameId: `${gamePrefix}-${gameIndex + 1}`,
    rules,
    whiteBot,
    blackBot,
    featureEncoding,
    randomFn,
    whiteOptions: whiteModelPath || whiteOrderingModelPath || whitePolicyModelPath ? {
      valueModel: whiteModelPath ? loadModelPayload(whiteModelPath) : undefined,
      orderingValueModel: whiteOrderingModelPath ? loadModelPayload(whiteOrderingModelPath) : undefined,
      policyModel: whitePolicyModelPath ? loadModelPayload(whitePolicyModelPath) : undefined,
      modelBlendWeight: whiteBlend,
      orderingWeight: whiteOrderingWeight,
      policyWeight: whitePolicyWeight,
      policyMaxPly: whitePolicyMaxPly
    } : undefined,
    blackOptions: blackModelPath || blackOrderingModelPath || blackPolicyModelPath ? {
      valueModel: blackModelPath ? loadModelPayload(blackModelPath) : undefined,
      orderingValueModel: blackOrderingModelPath ? loadModelPayload(blackOrderingModelPath) : undefined,
      policyModel: blackPolicyModelPath ? loadModelPayload(blackPolicyModelPath) : undefined,
      modelBlendWeight: blackBlend,
      orderingWeight: blackOrderingWeight,
      policyWeight: blackPolicyWeight,
      policyMaxPly: blackPolicyMaxPly
    } : undefined,
    teacherBot,
    teacherOptions: teacherBot ? {
      valueModel: teacherModelPath ? loadModelPayload(teacherModelPath) : undefined,
      orderingValueModel: teacherOrderingModelPath ? loadModelPayload(teacherOrderingModelPath) : undefined,
      policyModel: teacherPolicyModelPath ? loadModelPayload(teacherPolicyModelPath) : undefined,
      modelBlendWeight: teacherBlend,
      orderingWeight: teacherOrderingWeight,
      policyWeight: teacherPolicyWeight,
      policyMaxPly: teacherPolicyMaxPly,
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
  gamePrefix,
  whiteBot,
  blackBot,
  whiteModelPath,
  blackModelPath,
  whiteOrderingModelPath,
  blackOrderingModelPath,
  whitePolicyModelPath,
  blackPolicyModelPath,
  whiteBlend: Number.isFinite(whiteBlend) ? whiteBlend : null,
  blackBlend: Number.isFinite(blackBlend) ? blackBlend : null,
  whiteOrderingWeight: Number.isFinite(whiteOrderingWeight) ? whiteOrderingWeight : null,
  blackOrderingWeight: Number.isFinite(blackOrderingWeight) ? blackOrderingWeight : null,
  whitePolicyWeight: Number.isFinite(whitePolicyWeight) ? whitePolicyWeight : null,
  blackPolicyWeight: Number.isFinite(blackPolicyWeight) ? blackPolicyWeight : null,
  whitePolicyMaxPly: Number.isFinite(whitePolicyMaxPly) ? whitePolicyMaxPly : null,
  blackPolicyMaxPly: Number.isFinite(blackPolicyMaxPly) ? blackPolicyMaxPly : null,
  teacherBot,
  teacherModelPath,
  teacherOrderingModelPath,
  teacherPolicyModelPath,
  teacherBlend: Number.isFinite(teacherBlend) ? teacherBlend : null,
  teacherOrderingWeight: Number.isFinite(teacherOrderingWeight) ? teacherOrderingWeight : null,
  teacherPolicyWeight: Number.isFinite(teacherPolicyWeight) ? teacherPolicyWeight : null,
  teacherPolicyMaxPly: Number.isFinite(teacherPolicyMaxPly) ? teacherPolicyMaxPly : null,
  teacherMoveTime,
  teacherMaxDepth: teacherMaxDepth || null,
  featureEncoding,
  seed,
  moveTime,
  maxDepth: maxDepth || null,
  maxPlies,
  rulesSpec,
  featureSchema: featureSchema({ encoding: featureEncoding }),
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
  whitePolicyModelPath ? `White policy model: ${whitePolicyModelPath}` : null,
  blackPolicyModelPath ? `Black policy model: ${blackPolicyModelPath}` : null,
  teacherBot ? `Teacher bot: ${teacherBot}` : null,
  teacherModelPath ? `Teacher model: ${teacherModelPath}` : null,
  teacherOrderingModelPath ? `Teacher ordering model: ${teacherOrderingModelPath}` : null,
  teacherPolicyModelPath ? `Teacher policy model: ${teacherPolicyModelPath}` : null,
  `Feature encoding: ${featureEncoding}`,
  `Seed: ${seed}`,
  `Rules: ${rulesSpec}`,
  `Move time: ${moveTime}ms`
].join("\n") + "\n");
