const fs = require("node:fs");

const DEFAULT_SEARCH_SCALE = 600;
const DEFAULT_SEARCH_WEIGHT = 0.7;
const DEFAULT_OUTCOME_WEIGHT = 0.3;
const RULE_KEYS = [
  "friendlyFire",
  "kamikaze",
  "wrapAround",
  "doubleDirectionPawns",
  "jumpPawns"
];

function parseJsonLines(inputPath) {
  const raw = fs.readFileSync(inputPath, "utf8");

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function fnv1aHash(value) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function createSeededRandom(seedValue) {
  let state = fnv1aHash(String(seedValue || "chaos-chess"));

  return function seededRandom() {
    state += 0x6D2B79F5;
    let next = Math.imul(state ^ (state >>> 15), 1 | state);
    next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(items, randomFn) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(randomFn() * (index + 1));
    const temp = items[index];
    items[index] = items[swapIndex];
    items[swapIndex] = temp;
  }

  return items;
}

function normalizeSearchScore(score, scale) {
  if (score === null || score === undefined || score === "") {
    return null;
  }

  const numericScore = Number(score);
  const numericScale = Number(scale) || DEFAULT_SEARCH_SCALE;

  if (!Number.isFinite(numericScore)) {
    return null;
  }

  return Math.tanh(numericScore / numericScale);
}

function normalizeTargetWeights(searchWeight, outcomeWeight) {
  const safeSearchWeight = Math.max(0, Number(searchWeight));
  const safeOutcomeWeight = Math.max(0, Number(outcomeWeight));
  const total = safeSearchWeight + safeOutcomeWeight;

  if (total <= 0) {
    return {
      searchWeight: DEFAULT_SEARCH_WEIGHT,
      outcomeWeight: DEFAULT_OUTCOME_WEIGHT
    };
  }

  return {
    searchWeight: safeSearchWeight / total,
    outcomeWeight: safeOutcomeWeight / total
  };
}

function resolveScoreField(options) {
  const requested = options && options.scoreField;

  if (requested === "teacherScore") {
    return "teacherScore";
  }

  return "searchScore";
}

function rulesKeyFromRules(rules) {
  const activeRules = RULE_KEYS.filter((key) => Boolean(rules && rules[key]));

  return activeRules.length > 0 ? activeRules.join("+") : "classic";
}

function deriveValueTarget(sample, options) {
  const scoreField = resolveScoreField(options);
  const normalizedSearch = normalizeSearchScore(
    sample[scoreField],
    options && options.searchScale
  );
  const outcome = Number(sample.outcome);
  const weights = normalizeTargetWeights(
    options && options.searchWeight,
    options && options.outcomeWeight
  );

  if (normalizedSearch === null) {
    return Number.isFinite(outcome) ? outcome : 0;
  }

  if (!Number.isFinite(outcome)) {
    return normalizedSearch;
  }

  return (normalizedSearch * weights.searchWeight) + (outcome * weights.outcomeWeight);
}

function summarizeExport(records) {
  const byRules = {};
  let targetSum = 0;
  let searchValueCount = 0;

  for (const record of records) {
    const existing = byRules[record.rulesKey] || {
      count: 0,
      meanTarget: 0
    };

    existing.count += 1;
    existing.meanTarget += record.targetValue;
    byRules[record.rulesKey] = existing;
    targetSum += record.targetValue;

    if (record.searchValue !== null) {
      searchValueCount += 1;
    }
  }

  Object.keys(byRules).forEach((rulesKey) => {
    byRules[rulesKey].meanTarget = Number((byRules[rulesKey].meanTarget / byRules[rulesKey].count).toFixed(6));
  });

  return {
    sampleCount: records.length,
    meanTargetValue: records.length > 0 ? Number((targetSum / records.length).toFixed(6)) : 0,
    searchValueCoverage: records.length > 0 ? Number((searchValueCount / records.length).toFixed(6)) : 0,
    byRules
  };
}

function prepareTrainingRecord(sample, options) {
  if (!sample || !Array.isArray(sample.featureVector)) {
    return null;
  }

  const scoreField = resolveScoreField(options);

  return {
    features: sample.featureVector,
    featureEncoding: sample.featureEncoding || "absolute",
    targetValue: deriveValueTarget(sample, options),
    searchValue: normalizeSearchScore(sample[scoreField], options && options.searchScale),
    outcome: Number.isFinite(Number(sample.outcome)) ? Number(sample.outcome) : 0,
    rules: sample.rules || {},
    rulesKey: rulesKeyFromRules(sample.rules || {}),
    source: {
      gameId: sample.gameId || null,
      ply: Number.isFinite(Number(sample.ply)) ? Number(sample.ply) : null,
      engine: sample.engine || null,
      move: sample.move || null,
      notation: sample.notation || null,
      legalMoveCount: Number.isFinite(Number(sample.legalMoveCount)) ? Number(sample.legalMoveCount) : null,
      searchDepth: Number.isFinite(Number(sample.searchDepth)) ? Number(sample.searchDepth) : null,
      searchNodes: Number.isFinite(Number(sample.searchNodes)) ? Number(sample.searchNodes) : null,
      searchFallback: sample.searchFallback || null,
      teacherEngine: sample.teacherEngine || null,
      teacherMove: sample.teacherMove || null,
      teacherDepth: Number.isFinite(Number(sample.teacherDepth)) ? Number(sample.teacherDepth) : null,
      teacherNodes: Number.isFinite(Number(sample.teacherNodes)) ? Number(sample.teacherNodes) : null,
      teacherFallback: sample.teacherFallback || null,
      scoreField
    }
  };
}

module.exports = {
  DEFAULT_OUTCOME_WEIGHT,
  DEFAULT_SEARCH_SCALE,
  DEFAULT_SEARCH_WEIGHT,
  createSeededRandom,
  deriveValueTarget,
  normalizeSearchScore,
  normalizeTargetWeights,
  parseJsonLines,
  prepareTrainingRecord,
  resolveScoreField,
  rulesKeyFromRules,
  shuffleInPlace,
  summarizeExport
};
