#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const computer = require("../src/computer-engines.js");
const moveFeatures = require("../src/move-encoder.js");
const {
  parseArgs,
  ensureParentDir,
  restoreState
} = require("./ai-common.js");
const {
  createSeededRandom,
  parseJsonLines,
  rulesKeyFromRules,
  shuffleInPlace
} = require("./ml-data.js");
const {
  samplePassesHardFilters,
  teacherGap
} = require("./hard-position-data.js");

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

function resolveTeacherMove(sample, labelField) {
  if (labelField === "played") {
    return sample.move || null;
  }

  return sample.teacherMove || sample.move || null;
}

function shouldIncludeSample(sample, options) {
  if (!sample) {
    return false;
  }

  if (options.engine && sample.engine !== options.engine) {
    return false;
  }

  if (options.onlyDisagreements && sample.move && sample.teacherMove && sample.move === sample.teacherMove) {
    return false;
  }

  if (Number.isFinite(options.maxPly)) {
    const ply = Number(sample.ply);

    if (!Number.isFinite(ply) || ply > options.maxPly) {
      return false;
    }
  }

  if (!samplePassesHardFilters(sample, options)) {
    return false;
  }

  return true;
}

function bundlePosition(sample, options) {
  const labelField = options.labelField || "teacher";
  const state = restoreState(sample.stateSnapshot);
  const targetMove = resolveTeacherMove(sample, labelField);
  const rankedCandidates = state && Number.isFinite(options.candidateTopK)
    ? computer.rankRootCandidates(state, {
      topK: options.candidateTopK
    })
    : null;
  const shortlist = rankedCandidates
    ? new Set(rankedCandidates.map((entry) => entry.uci))
    : null;

  if (!state || !targetMove) {
    return null;
  }

  const candidates = computer.expandMoveCandidates(state).filter((candidate) => {
    if (!shortlist) {
      return true;
    }

    return shortlist.has(moveFeatures.candidateToUci(candidate));
  });
  const matchingCandidates = candidates.filter((candidate) => moveFeatures.candidateToUci(candidate) === targetMove);

  if (matchingCandidates.length === 0) {
    return null;
  }

  const featureEncoding = sample.featureEncoding === "absolute" ? "absolute" : "canonical";
  const positionId = `${sample.gameId || "game"}:${Number.isFinite(Number(sample.ply)) ? Number(sample.ply) : 0}`;
  const records = candidates.map((candidate) => {
    const uci = moveFeatures.candidateToUci(candidate);

    return {
      features: moveFeatures.encodeCandidateVector(state, candidate, {
        encoding: featureEncoding,
        legalMoveCount: candidates.length
      }),
      label: uci === targetMove ? 1 : 0,
      featureEncoding,
      positionId,
      legalMoveCount: candidates.length,
      move: uci,
      teacherMove: sample.teacherMove || null,
      playedMove: sample.move || null,
      rules: sample.rules || state.rules,
      rulesKey: rulesKeyFromRules(sample.rules || state.rules || {}),
      source: {
        gameId: sample.gameId || null,
        ply: Number.isFinite(Number(sample.ply)) ? Number(sample.ply) : null,
        engine: sample.engine || null,
        teacherEngine: sample.teacherEngine || null,
        teacherDepth: Number.isFinite(Number(sample.teacherDepth)) ? Number(sample.teacherDepth) : null,
        teacherNodes: Number.isFinite(Number(sample.teacherNodes)) ? Number(sample.teacherNodes) : null,
        searchDepth: Number.isFinite(Number(sample.searchDepth)) ? Number(sample.searchDepth) : null,
        searchNodes: Number.isFinite(Number(sample.searchNodes)) ? Number(sample.searchNodes) : null,
        teacherGap: teacherGap(sample),
        labelField,
        candidateTopK: Number.isFinite(options.candidateTopK) ? options.candidateTopK : null
      }
    };
  });

  return {
    positionId,
    rulesKey: rulesKeyFromRules(sample.rules || state.rules || {}),
    legalMoveCount: candidates.length,
    featureEncoding,
    records
  };
}

function splitPositions(positions, validationRatio) {
  if (positions.length <= 1) {
    return {
      train: positions.slice(),
      validation: []
    };
  }

  const validationCount = Math.max(1, Math.round(positions.length * validationRatio));
  const splitIndex = Math.max(1, positions.length - validationCount);

  return {
    train: positions.slice(0, splitIndex),
    validation: positions.slice(splitIndex)
  };
}

function flattenPositionRecords(positions) {
  return positions.flatMap((position) => position.records);
}

function summarizePolicyRecords(records) {
  const byRules = {};
  const positions = new Set();
  let positives = 0;
  let legalMoveCountSum = 0;

  for (const record of records) {
    const rulesKey = record.rulesKey || "classic";
    const existing = byRules[rulesKey] || {
      positions: new Set(),
      candidates: 0,
      positives: 0
    };

    positions.add(record.positionId);
    existing.positions.add(record.positionId);
    existing.candidates += 1;
    existing.positives += record.label;
    byRules[rulesKey] = existing;
    positives += record.label;
    legalMoveCountSum += Number(record.legalMoveCount) || 0;
  }

  Object.keys(byRules).forEach((rulesKey) => {
    byRules[rulesKey] = {
      positionCount: byRules[rulesKey].positions.size,
      candidateCount: byRules[rulesKey].candidates,
      positiveCount: byRules[rulesKey].positives
    };
  });

  return {
    positionCount: positions.size,
    candidateCount: records.length,
    positiveCount: positives,
    positiveRate: records.length > 0 ? Number((positives / records.length).toFixed(6)) : 0,
    averageLegalMoveCount: records.length > 0 ? Number((legalMoveCountSum / records.length).toFixed(6)) : 0,
    byRules
  };
}

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(process.cwd(), args.input || "ml/datasets/selfplay.jsonl");
const trainOutputPath = path.resolve(process.cwd(), args["train-output"] || "ml/datasets/policy-train.jsonl");
const validationOutputPath = path.resolve(process.cwd(), args["validation-output"] || "ml/datasets/policy-validation.jsonl");
const summaryOutputPath = path.resolve(process.cwd(), args["summary-output"] || "ml/datasets/policy-dataset.metadata.json");
const validationRatio = clampRatio(args["validation-ratio"], 0.2);
const maxPositions = args["max-positions"] ? Math.max(1, Number(args["max-positions"])) : null;
const seed = args.seed || "chaos-chess-policy";
const labelField = args["label-field"] === "played" ? "played" : "teacher";
const engineFilter = args.engine || null;
const onlyDisagreements = args["only-disagreements"] === "true" || args["only-disagreements"] === true;
const maxPly = args["max-ply"] ? Number(args["max-ply"]) : undefined;
const candidateTopK = args["candidate-top-k"] ? Number(args["candidate-top-k"]) : undefined;
const minimumTeacherGap = args["min-teacher-gap"] ? Number(args["min-teacher-gap"]) : undefined;
const rawSamples = parseJsonLines(inputPath);
let positions = rawSamples
  .filter((sample) => shouldIncludeSample(sample, {
    engine: engineFilter,
    onlyDisagreements,
    maxPly,
    minimumTeacherGap
  }))
  .map((sample) => bundlePosition(sample, {
    labelField,
    candidateTopK
  }))
  .filter(Boolean);

shuffleInPlace(positions, createSeededRandom(seed));

if (maxPositions) {
  positions = positions.slice(0, maxPositions);
}

const split = splitPositions(positions, validationRatio);
const trainRecords = flattenPositionRecords(split.train);
const validationRecords = flattenPositionRecords(split.validation);
const featureEncoding = positions.length > 0 ? positions[0].featureEncoding : "canonical";
const metadata = {
  format: "chaos-chess-policy-dataset-v1",
  generatedAt: new Date().toISOString(),
  inputPath,
  seed,
  featureEncoding,
  featureSchema: moveFeatures.featureSchema({ encoding: featureEncoding }),
  targetSpec: {
    type: "candidate_teacher_move",
    labelField,
    engineFilter,
    onlyDisagreements,
    maxPly: Number.isFinite(maxPly) ? maxPly : null,
    minimumTeacherGap: Number.isFinite(minimumTeacherGap) ? minimumTeacherGap : null,
    candidateTopK: Number.isFinite(candidateTopK) ? candidateTopK : null
  },
  totals: summarizePolicyRecords(flattenPositionRecords(positions)),
  train: summarizePolicyRecords(trainRecords),
  validation: summarizePolicyRecords(validationRecords)
};

writeJsonLines(trainOutputPath, trainRecords);
writeJsonLines(validationOutputPath, validationRecords);
ensureParentDir(summaryOutputPath);
fs.writeFileSync(summaryOutputPath, JSON.stringify(metadata, null, 2));

process.stdout.write([
  `Exported ${positions.length} policy positions`,
  `Train positions: ${split.train.length} -> ${trainOutputPath}`,
  `Validation positions: ${split.validation.length} -> ${validationOutputPath}`,
  `Metadata: ${summaryOutputPath}`
].join("\n") + "\n");
