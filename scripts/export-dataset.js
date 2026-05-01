#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  ensureParentDir,
  featureSchema
} = require("./ai-common.js");
const {
  DEFAULT_OUTCOME_WEIGHT,
  DEFAULT_SEARCH_SCALE,
  DEFAULT_SEARCH_WEIGHT,
  createSeededRandom,
  normalizeTargetWeights,
  parseJsonLines,
  prepareTrainingRecord,
  shuffleInPlace,
  summarizeExport
} = require("./ml-data.js");

function clampRatio(value, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(0.5, Math.max(0.05, numericValue));
}

function writeJsonLines(outputPath, records) {
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : ""));
}

function splitRecords(records, validationRatio) {
  if (records.length <= 1) {
    return {
      train: records.slice(),
      validation: []
    };
  }

  const validationCount = Math.max(1, Math.round(records.length * validationRatio));
  const splitIndex = Math.max(1, records.length - validationCount);

  return {
    train: records.slice(0, splitIndex),
    validation: records.slice(splitIndex)
  };
}

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(process.cwd(), args.input || "ml/datasets/selfplay.jsonl");
const trainOutputPath = path.resolve(process.cwd(), args["train-output"] || "ml/datasets/value-train.jsonl");
const validationOutputPath = path.resolve(process.cwd(), args["validation-output"] || "ml/datasets/value-validation.jsonl");
const summaryOutputPath = path.resolve(process.cwd(), args["summary-output"] || "ml/datasets/value-dataset.metadata.json");
const validationRatio = clampRatio(args["validation-ratio"], 0.2);
const maxSamples = args["max-samples"] ? Math.max(1, Number(args["max-samples"])) : null;
const seed = args.seed || "chaos-chess";
const searchScale = Number(args["search-scale"]) || DEFAULT_SEARCH_SCALE;
const scoreField = args["score-field"] === "teacherScore" ? "teacherScore" : "searchScore";
const weights = normalizeTargetWeights(
  args["search-weight"] || DEFAULT_SEARCH_WEIGHT,
  args["outcome-weight"] || DEFAULT_OUTCOME_WEIGHT
);
const rawSamples = parseJsonLines(inputPath);
let records = rawSamples
  .map((sample) => prepareTrainingRecord(sample, {
    scoreField,
    searchScale,
    searchWeight: weights.searchWeight,
    outcomeWeight: weights.outcomeWeight
  }))
  .filter(Boolean);

shuffleInPlace(records, createSeededRandom(seed));

if (maxSamples) {
  records = records.slice(0, maxSamples);
}

const split = splitRecords(records, validationRatio);
const metadata = {
  format: "chaos-chess-value-dataset-v1",
  generatedAt: new Date().toISOString(),
  inputPath,
  seed,
  featureEncoding: records.length > 0 ? records[0].featureEncoding : "absolute",
  featureSchema: featureSchema({
    encoding: records.length > 0 ? records[0].featureEncoding : "absolute"
  }),
  targetSpec: {
    type: "blended_value",
    scoreField,
    searchScale,
    searchWeight: weights.searchWeight,
    outcomeWeight: weights.outcomeWeight
  },
  totals: summarizeExport(records),
  train: summarizeExport(split.train),
  validation: summarizeExport(split.validation)
};

writeJsonLines(trainOutputPath, split.train);
writeJsonLines(validationOutputPath, split.validation);
ensureParentDir(summaryOutputPath);
fs.writeFileSync(summaryOutputPath, JSON.stringify(metadata, null, 2));

process.stdout.write([
  `Exported ${records.length} value-training samples`,
  `Train: ${split.train.length} -> ${trainOutputPath}`,
  `Validation: ${split.validation.length} -> ${validationOutputPath}`,
  `Metadata: ${summaryOutputPath}`
].join("\n") + "\n");
