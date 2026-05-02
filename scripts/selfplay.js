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

function parseBooleanFlag(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  switch (String(value).trim().toLowerCase()) {
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      return true;
  }
}

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
const whitePolicyTopK = args["white-policy-top-k"] ? Number(args["white-policy-top-k"]) : undefined;
const blackPolicyTopK = args["black-policy-top-k"] ? Number(args["black-policy-top-k"]) : undefined;
const whitePolicyUseSoftmax = parseBooleanFlag(args["white-policy-use-softmax"]);
const blackPolicyUseSoftmax = parseBooleanFlag(args["black-policy-use-softmax"]);
const whitePolicyConfidenceThreshold = args["white-policy-confidence-threshold"]
  ? Number(args["white-policy-confidence-threshold"])
  : undefined;
const blackPolicyConfidenceThreshold = args["black-policy-confidence-threshold"]
  ? Number(args["black-policy-confidence-threshold"])
  : undefined;
const whitePolicyUseShortlistCount = parseBooleanFlag(args["white-policy-use-shortlist-count"]);
const blackPolicyUseShortlistCount = parseBooleanFlag(args["black-policy-use-shortlist-count"]);
const teacherBot = args.teacher || null;
const teacherModelPath = args["teacher-model"] || null;
const teacherOrderingModelPath = args["teacher-ordering-model"] || null;
const teacherPolicyModelPath = args["teacher-policy-model"] || null;
const teacherBlend = args["teacher-blend"] ? Number(args["teacher-blend"]) : undefined;
const teacherOrderingWeight = args["teacher-ordering-weight"] ? Number(args["teacher-ordering-weight"]) : undefined;
const teacherPolicyWeight = args["teacher-policy-weight"] ? Number(args["teacher-policy-weight"]) : undefined;
const teacherPolicyMaxPly = args["teacher-policy-max-ply"] ? Number(args["teacher-policy-max-ply"]) : undefined;
const teacherPolicyTopK = args["teacher-policy-top-k"] ? Number(args["teacher-policy-top-k"]) : undefined;
const teacherPolicyUseSoftmax = parseBooleanFlag(args["teacher-policy-use-softmax"]);
const teacherPolicyConfidenceThreshold = args["teacher-policy-confidence-threshold"]
  ? Number(args["teacher-policy-confidence-threshold"])
  : undefined;
const teacherPolicyUseShortlistCount = parseBooleanFlag(args["teacher-policy-use-shortlist-count"]);
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
      policyMaxPly: whitePolicyMaxPly,
      policyTopK: whitePolicyTopK,
      policyUseSoftmax: whitePolicyUseSoftmax,
      policyConfidenceThreshold: whitePolicyConfidenceThreshold,
      policyUseShortlistCount: whitePolicyUseShortlistCount
    } : undefined,
    blackOptions: blackModelPath || blackOrderingModelPath || blackPolicyModelPath ? {
      valueModel: blackModelPath ? loadModelPayload(blackModelPath) : undefined,
      orderingValueModel: blackOrderingModelPath ? loadModelPayload(blackOrderingModelPath) : undefined,
      policyModel: blackPolicyModelPath ? loadModelPayload(blackPolicyModelPath) : undefined,
      modelBlendWeight: blackBlend,
      orderingWeight: blackOrderingWeight,
      policyWeight: blackPolicyWeight,
      policyMaxPly: blackPolicyMaxPly,
      policyTopK: blackPolicyTopK,
      policyUseSoftmax: blackPolicyUseSoftmax,
      policyConfidenceThreshold: blackPolicyConfidenceThreshold,
      policyUseShortlistCount: blackPolicyUseShortlistCount
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
      policyTopK: teacherPolicyTopK,
      policyUseSoftmax: teacherPolicyUseSoftmax,
      policyConfidenceThreshold: teacherPolicyConfidenceThreshold,
      policyUseShortlistCount: teacherPolicyUseShortlistCount,
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
  whitePolicyTopK: Number.isFinite(whitePolicyTopK) ? whitePolicyTopK : null,
  blackPolicyTopK: Number.isFinite(blackPolicyTopK) ? blackPolicyTopK : null,
  whitePolicyUseSoftmax: whitePolicyUseSoftmax === undefined ? null : whitePolicyUseSoftmax,
  blackPolicyUseSoftmax: blackPolicyUseSoftmax === undefined ? null : blackPolicyUseSoftmax,
  whitePolicyConfidenceThreshold: Number.isFinite(whitePolicyConfidenceThreshold)
    ? whitePolicyConfidenceThreshold
    : null,
  blackPolicyConfidenceThreshold: Number.isFinite(blackPolicyConfidenceThreshold)
    ? blackPolicyConfidenceThreshold
    : null,
  whitePolicyUseShortlistCount: whitePolicyUseShortlistCount === undefined ? null : whitePolicyUseShortlistCount,
  blackPolicyUseShortlistCount: blackPolicyUseShortlistCount === undefined ? null : blackPolicyUseShortlistCount,
  teacherBot,
  teacherModelPath,
  teacherOrderingModelPath,
  teacherPolicyModelPath,
  teacherBlend: Number.isFinite(teacherBlend) ? teacherBlend : null,
  teacherOrderingWeight: Number.isFinite(teacherOrderingWeight) ? teacherOrderingWeight : null,
  teacherPolicyWeight: Number.isFinite(teacherPolicyWeight) ? teacherPolicyWeight : null,
  teacherPolicyMaxPly: Number.isFinite(teacherPolicyMaxPly) ? teacherPolicyMaxPly : null,
  teacherPolicyTopK: Number.isFinite(teacherPolicyTopK) ? teacherPolicyTopK : null,
  teacherPolicyUseSoftmax: teacherPolicyUseSoftmax === undefined ? null : teacherPolicyUseSoftmax,
  teacherPolicyConfidenceThreshold: Number.isFinite(teacherPolicyConfidenceThreshold)
    ? teacherPolicyConfidenceThreshold
    : null,
  teacherPolicyUseShortlistCount: teacherPolicyUseShortlistCount === undefined ? null : teacherPolicyUseShortlistCount,
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
