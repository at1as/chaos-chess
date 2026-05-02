#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { parseArgs, ensureParentDir } = require("./ai-common.js");
const { parseJsonLines } = require("./ml-data.js");
const {
  createPairwiseRecords,
  summarizePairwiseRecords,
  resolvePairMode,
  resolveWeightMode
} = require("./pairwise-policy-data.js");

function writeJsonLines(outputPath, records) {
  ensureParentDir(outputPath);
  fs.writeFileSync(outputPath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length > 0 ? "\n" : ""));
}

const args = parseArgs(process.argv.slice(2));
const trainInputPath = path.resolve(process.cwd(), args["train-input"] || "ml/datasets/policy-distill-train.jsonl");
const validationInputPath = path.resolve(process.cwd(), args["validation-input"] || "ml/datasets/policy-distill-validation.jsonl");
const trainOutputPath = path.resolve(process.cwd(), args["train-output"] || "ml/datasets/pairwise-policy-train.jsonl");
const validationOutputPath = path.resolve(process.cwd(), args["validation-output"] || "ml/datasets/pairwise-policy-validation.jsonl");
const summaryOutputPath = path.resolve(process.cwd(), args["summary-output"] || "ml/datasets/pairwise-policy.metadata.json");
const searchScale = args["search-scale"] ? Number(args["search-scale"]) : undefined;
const minimumWeight = args["minimum-weight"] ? Number(args["minimum-weight"]) : 0.05;
const pairMode = resolvePairMode({
  pairMode: args["pair-mode"]
});
const weightMode = resolveWeightMode({
  weightMode: args["weight-mode"]
});
const mappingOptions = {
  searchScale,
  minimumWeight,
  pairMode,
  weightMode
};

const trainRows = parseJsonLines(trainInputPath);
const validationRows = parseJsonLines(validationInputPath);
const trainPairs = createPairwiseRecords(trainRows, mappingOptions);
const validationPairs = createPairwiseRecords(validationRows, mappingOptions);
const metadata = {
  format: "chaos-chess-pairwise-policy-v1",
  generatedAt: new Date().toISOString(),
  trainInputPath,
  validationInputPath,
  targetSpec: {
    type: "pairwise_move_ranking",
    pairMode,
    weightMode,
    searchScale: Number.isFinite(searchScale) ? searchScale : null,
    minimumWeight
  },
  train: summarizePairwiseRecords(trainPairs),
  validation: summarizePairwiseRecords(validationPairs)
};

writeJsonLines(trainOutputPath, trainPairs);
writeJsonLines(validationOutputPath, validationPairs);
ensureParentDir(summaryOutputPath);
fs.writeFileSync(summaryOutputPath, JSON.stringify(metadata, null, 2));

process.stdout.write([
  `Exported ${trainPairs.length + validationPairs.length} pairwise policy samples`,
  `Train pairs: ${trainPairs.length} -> ${trainOutputPath}`,
  `Validation pairs: ${validationPairs.length} -> ${validationOutputPath}`,
  `Metadata: ${summaryOutputPath}`
].join("\n") + "\n");
