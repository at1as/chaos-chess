#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {
  parseArgs,
  ensureParentDir
} = require("./ai-common.js");
const {
  DEFAULT_SEARCH_SCALE,
  createSeededRandom,
  parseJsonLines,
  shuffleInPlace
} = require("./ml-data.js");
const {
  createCandidateScoreRecord,
  summarizeCandidateScoreRecords,
  resolveScoreField
} = require("./candidate-score-data.js");

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

function mapRecords(samples, options) {
  return samples
    .map((sample) => createCandidateScoreRecord(sample, options))
    .filter(Boolean);
}

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input ? path.resolve(process.cwd(), args.input) : null;
const trainInputPath = args["train-input"] ? path.resolve(process.cwd(), args["train-input"]) : null;
const validationInputPath = args["validation-input"] ? path.resolve(process.cwd(), args["validation-input"]) : null;
const trainOutputPath = path.resolve(process.cwd(), args["train-output"] || "ml/datasets/candidate-score-train.jsonl");
const validationOutputPath = path.resolve(process.cwd(), args["validation-output"] || "ml/datasets/candidate-score-validation.jsonl");
const summaryOutputPath = path.resolve(process.cwd(), args["summary-output"] || "ml/datasets/candidate-score.metadata.json");
const validationRatio = clampRatio(args["validation-ratio"], 0.2);
const maxSamples = args["max-samples"] ? Math.max(1, Number(args["max-samples"])) : null;
const seed = args.seed || "chaos-chess-candidate-score";
const searchScale = Number(args["search-scale"]) || DEFAULT_SEARCH_SCALE;
const scoreField = resolveScoreField({
  scoreField: args["score-field"]
});
const mappingOptions = {
  searchScale,
  scoreField
};
let trainRecords;
let validationRecords;
let totalRecords;

if (inputPath) {
  totalRecords = mapRecords(parseJsonLines(inputPath), mappingOptions);
  shuffleInPlace(totalRecords, createSeededRandom(seed));

  if (maxSamples) {
    totalRecords = totalRecords.slice(0, maxSamples);
  }

  ({ train: trainRecords, validation: validationRecords } = splitRecords(totalRecords, validationRatio));
} else {
  if (!trainInputPath) {
    throw new Error("Provide either --input or --train-input.");
  }

  trainRecords = mapRecords(parseJsonLines(trainInputPath), mappingOptions);
  validationRecords = validationInputPath
    ? mapRecords(parseJsonLines(validationInputPath), mappingOptions)
    : [];
  totalRecords = trainRecords.concat(validationRecords);

  if (maxSamples) {
    totalRecords = totalRecords.slice(0, maxSamples);
    trainRecords = totalRecords.slice(0, Math.min(trainRecords.length, totalRecords.length));
    validationRecords = totalRecords.slice(trainRecords.length);
  }
}

const featureEncoding = totalRecords.length > 0 ? totalRecords[0].featureEncoding : "canonical";
const metadata = {
  format: "chaos-chess-candidate-score-v1",
  generatedAt: new Date().toISOString(),
  inputPath,
  trainInputPath,
  validationInputPath,
  seed,
  featureEncoding,
  targetSpec: {
    type: "candidate_score_regression",
    scoreField,
    searchScale
  },
  totals: summarizeCandidateScoreRecords(totalRecords),
  train: summarizeCandidateScoreRecords(trainRecords),
  validation: summarizeCandidateScoreRecords(validationRecords)
};

writeJsonLines(trainOutputPath, trainRecords);
writeJsonLines(validationOutputPath, validationRecords);
ensureParentDir(summaryOutputPath);
fs.writeFileSync(summaryOutputPath, JSON.stringify(metadata, null, 2));

process.stdout.write([
  `Exported ${totalRecords.length} candidate-score samples`,
  `Train: ${trainRecords.length} -> ${trainOutputPath}`,
  `Validation: ${validationRecords.length} -> ${validationOutputPath}`,
  `Metadata: ${summaryOutputPath}`
].join("\n") + "\n");
