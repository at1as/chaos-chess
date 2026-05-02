#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const computer = require("../src/computer-engines.js");
const moveFeatures = require("../src/move-encoder.js");
const {
  parseArgs,
  ensureParentDir,
  restoreState,
  loadModelPayload
} = require("./ai-common.js");
const {
  createSeededRandom,
  parseJsonLines,
  rulesKeyFromRules,
  shuffleInPlace
} = require("./ml-data.js");
const {
  rootCandidatesPassHardFilters,
  rootMargin,
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

function softmaxScores(entries, temperature) {
  const safeTemperature = Number.isFinite(Number(temperature)) && Number(temperature) > 0
    ? Number(temperature)
    : 200;
  const maxScore = entries.reduce((best, entry) => Math.max(best, Number(entry.score) || -Infinity), -Infinity);
  const exps = entries.map((entry) => Math.exp(((Number(entry.score) || 0) - maxScore) / safeTemperature));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;

  return exps.map((value) => value / total);
}

function truncateDistribution(probabilities, scores, topK) {
  const safeTopK = Number(topK);
  const indexed = probabilities.map((probability, index) => ({
    index,
    probability,
    score: Number(scores[index]) || 0
  }));
  let total = 0;
  const next = new Array(probabilities.length).fill(0);

  if (!Number.isFinite(safeTopK) || safeTopK <= 0 || safeTopK >= probabilities.length) {
    return probabilities;
  }

  indexed.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.index - right.index;
  });

  indexed.slice(0, safeTopK).forEach((entry) => {
    next[entry.index] = entry.probability;
    total += entry.probability;
  });

  if (total <= 0) {
    return probabilities;
  }

  return next.map((value) => value / total);
}

function bundlePosition(sample, options) {
  const state = restoreState(sample.stateSnapshot);
  const rankedCandidates = state && Number.isFinite(options.candidateTopK)
    ? computer.rankRootCandidates(state, {
      topK: options.candidateTopK
    })
    : null;
  const shortlist = rankedCandidates
    ? new Set(rankedCandidates.map((entry) => entry.uci))
    : null;
  const teacherResult = state ? computer.searchPosition(state, {
    moveTime: options.moveTime,
    maxDepth: options.maxDepth,
    valueModel: options.valueModel,
    modelBlendWeight: options.modelBlendWeight,
    orderingValueModel: options.orderingValueModel,
    orderingWeight: options.orderingWeight,
    policyModel: options.policyModel,
    policyWeight: options.policyWeight,
    policyMaxPly: options.policyMaxPly,
    policyTopK: options.policyTopK,
    includeRootScores: true
  }) : null;
  const rootCandidates = teacherResult && Array.isArray(teacherResult.rootCandidates)
    ? teacherResult.rootCandidates
      .filter((entry) => !shortlist || shortlist.has(entry.uci))
      .slice()
    : null;

  if (!state || !rootCandidates || rootCandidates.length === 0) {
    return null;
  }

  if (!rootCandidatesPassHardFilters(rootCandidates, options)) {
    return null;
  }

  const featureEncoding = sample.featureEncoding === "absolute" ? "absolute" : "canonical";
  const positionId = `${sample.gameId || "game"}:${Number.isFinite(Number(sample.ply)) ? Number(sample.ply) : 0}`;
  const rawTargetProbabilities = softmaxScores(rootCandidates, options.temperature);
  const targetProbabilities = truncateDistribution(
    rawTargetProbabilities,
    rootCandidates.map((entry) => entry.score),
    options.targetTopK
  );
  const bestScore = Math.max.apply(null, rootCandidates.map((entry) => Number(entry.score) || -Infinity));
  const records = rootCandidates.map((entry, index) => {
    const candidate = {
      move: {
        from: entry.move.from,
        to: entry.move.to,
        piece: null,
        capture: null,
        captureSquare: null,
        isFriendlyCapture: false,
        isCastle: false,
        isEnPassant: false,
        crossesWrap: false
      },
      promotion: entry.move.promotion || null
    };
    const expanded = computer.expandMoveCandidates(state).find((legalCandidate) => moveFeatures.candidateToUci(legalCandidate) === entry.uci);
    const score = Number(entry.score) || 0;

    if (!expanded) {
      return null;
    }

    return {
      features: moveFeatures.encodeCandidateVector(state, expanded, {
        encoding: featureEncoding,
        legalMoveCount: rootCandidates.length
      }),
      targetProbability: targetProbabilities[index],
      targetScore: score,
      targetScoreDelta: score - bestScore,
      isTeacherBest: score === bestScore ? 1 : 0,
      featureEncoding,
      positionId,
      legalMoveCount: rootCandidates.length,
      move: entry.uci,
      rules: sample.rules || state.rules,
      rulesKey: rulesKeyFromRules(sample.rules || state.rules || {}),
      source: {
        gameId: sample.gameId || null,
        ply: Number.isFinite(Number(sample.ply)) ? Number(sample.ply) : null,
        engine: sample.engine || null,
        teacherEngine: sample.teacherEngine || null,
        teacherDepth: teacherResult.depth,
        teacherNodes: teacherResult.nodes,
        distillTemperature: options.temperature,
        candidateTopK: Number.isFinite(options.candidateTopK) ? options.candidateTopK : null,
        teacherGap: teacherGap(sample),
        rootMargin: rootMargin(rootCandidates)
      }
    };
  }).filter(Boolean);

  return {
    positionId,
    rulesKey: rulesKeyFromRules(sample.rules || state.rules || {}),
    legalMoveCount: rootCandidates.length,
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
  let legalMoveCountSum = 0;

  for (const record of records) {
    const rulesKey = record.rulesKey || "classic";
    const existing = byRules[rulesKey] || {
      positions: new Set(),
      candidates: 0,
      bests: 0
    };

    positions.add(record.positionId);
    existing.positions.add(record.positionId);
    existing.candidates += 1;
    existing.bests += record.isTeacherBest;
    byRules[rulesKey] = existing;
    legalMoveCountSum += Number(record.legalMoveCount) || 0;
  }

  Object.keys(byRules).forEach((rulesKey) => {
    byRules[rulesKey] = {
      positionCount: byRules[rulesKey].positions.size,
      candidateCount: byRules[rulesKey].candidates,
      teacherBestCount: byRules[rulesKey].bests
    };
  });

  return {
    positionCount: positions.size,
    candidateCount: records.length,
    averageLegalMoveCount: records.length > 0 ? Number((legalMoveCountSum / records.length).toFixed(6)) : 0,
    byRules
  };
}

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(process.cwd(), args.input || "ml/datasets/selfplay.jsonl");
const trainOutputPath = path.resolve(process.cwd(), args["train-output"] || "ml/datasets/policy-distill-train.jsonl");
const validationOutputPath = path.resolve(process.cwd(), args["validation-output"] || "ml/datasets/policy-distill-validation.jsonl");
const summaryOutputPath = path.resolve(process.cwd(), args["summary-output"] || "ml/datasets/policy-distill.metadata.json");
const validationRatio = clampRatio(args["validation-ratio"], 0.2);
const maxPositions = args["max-positions"] ? Math.max(1, Number(args["max-positions"])) : null;
const seed = args.seed || "chaos-chess-policy-distill";
const engineFilter = args.engine || null;
const onlyDisagreements = args["only-disagreements"] === "true" || args["only-disagreements"] === true;
const maxPly = args["max-ply"] ? Number(args["max-ply"]) : undefined;
const minimumTeacherGap = args["min-teacher-gap"] ? Number(args["min-teacher-gap"]) : undefined;
const minimumRootMargin = args["min-root-margin"] ? Number(args["min-root-margin"]) : undefined;
const candidateTopK = args["candidate-top-k"] ? Number(args["candidate-top-k"]) : undefined;
const moveTime = args["teacher-move-time"] ? Number(args["teacher-move-time"]) : 120;
const maxDepth = args["teacher-max-depth"] ? Number(args["teacher-max-depth"]) : undefined;
const temperature = args.temperature ? Number(args.temperature) : 200;
const targetTopK = args["target-top-k"] ? Number(args["target-top-k"]) : undefined;
const valueModelPath = args["teacher-model"] || null;
const orderingModelPath = args["teacher-ordering-model"] || null;
const policyModelPath = args["teacher-policy-model"] || null;
const modelBlendWeight = args["teacher-blend"] ? Number(args["teacher-blend"]) : undefined;
const orderingWeight = args["teacher-ordering-weight"] ? Number(args["teacher-ordering-weight"]) : undefined;
const policyWeight = args["teacher-policy-weight"] ? Number(args["teacher-policy-weight"]) : undefined;
const policyMaxPly = args["teacher-policy-max-ply"] ? Number(args["teacher-policy-max-ply"]) : undefined;
const policyTopK = args["teacher-policy-top-k"] ? Number(args["teacher-policy-top-k"]) : undefined;
const rawSamples = parseJsonLines(inputPath);
let positions = rawSamples
  .filter((sample) => shouldIncludeSample(sample, {
    engine: engineFilter,
    onlyDisagreements,
    maxPly,
    minimumTeacherGap
  }))
  .map((sample) => bundlePosition(sample, {
    moveTime,
    maxDepth,
    temperature,
    targetTopK,
    candidateTopK,
    minimumRootMargin,
    valueModel: valueModelPath ? loadModelPayload(valueModelPath) : undefined,
    orderingValueModel: orderingModelPath ? loadModelPayload(orderingModelPath) : undefined,
    policyModel: policyModelPath ? loadModelPayload(policyModelPath) : undefined,
    modelBlendWeight,
    orderingWeight,
    policyWeight,
    policyMaxPly,
    policyTopK
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
  format: "chaos-chess-policy-distill-dataset-v1",
  generatedAt: new Date().toISOString(),
  inputPath,
  seed,
  featureEncoding,
  featureSchema: moveFeatures.featureSchema({ encoding: featureEncoding }),
  targetSpec: {
    type: "candidate_teacher_distribution",
    engineFilter,
    onlyDisagreements,
    maxPly: Number.isFinite(maxPly) ? maxPly : null,
    minimumTeacherGap: Number.isFinite(minimumTeacherGap) ? minimumTeacherGap : null,
    minimumRootMargin: Number.isFinite(minimumRootMargin) ? minimumRootMargin : null,
    candidateTopK: Number.isFinite(candidateTopK) ? candidateTopK : null,
    temperature,
    targetTopK: Number.isFinite(targetTopK) ? targetTopK : null,
    moveTime,
    maxDepth: Number.isFinite(maxDepth) ? maxDepth : null
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
  `Exported ${positions.length} distilled policy positions`,
  `Train positions: ${split.train.length} -> ${trainOutputPath}`,
  `Validation positions: ${split.validation.length} -> ${validationOutputPath}`,
  `Metadata: ${summaryOutputPath}`
].join("\n") + "\n");
