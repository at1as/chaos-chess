const {
  DEFAULT_SEARCH_SCALE,
  normalizeSearchScore
} = require("./ml-data.js");

function clampWeight(value, minimumWeight) {
  return Math.max(Number(minimumWeight) || 0, Math.min(1, Number(value) || 0));
}

function resolveWeightMode(options) {
  return options && options.weightMode === "probability_gap"
    ? "probability_gap"
    : "score_gap";
}

function resolvePairMode(options) {
  return options && options.pairMode === "all_pairs"
    ? "all_pairs"
    : "best_vs_rest";
}

function buildPairWeight(betterRecord, worseRecord, options) {
  const searchScale = Number(options && options.searchScale) || DEFAULT_SEARCH_SCALE;
  const minimumWeight = Number(options && options.minimumWeight);
  const weightMode = resolveWeightMode(options);
  let rawWeight;

  if (weightMode === "probability_gap") {
    rawWeight = Number(betterRecord.targetProbability) - Number(worseRecord.targetProbability);
  } else {
    rawWeight = normalizeSearchScore(
      Number(betterRecord.targetScore) - Number(worseRecord.targetScore),
      searchScale
    );
  }

  return clampWeight(rawWeight, minimumWeight);
}

function groupCandidateRows(rows) {
  const grouped = new Map();

  rows.forEach((row) => {
    if (!row || !Array.isArray(row.features) || !row.positionId) {
      return;
    }

    if (!grouped.has(row.positionId)) {
      grouped.set(row.positionId, []);
    }

    grouped.get(row.positionId).push(row);
  });

  return Array.from(grouped.entries()).map(([positionId, candidates]) => ({
    positionId,
    candidates
  }));
}

function createPairwiseRecords(rows, options) {
  const pairMode = resolvePairMode(options);
  const positions = groupCandidateRows(rows);
  const pairs = [];

  positions.forEach((position) => {
    const candidates = position.candidates.slice().sort((left, right) => {
      const scoreDifference = Number(right.targetScore) - Number(left.targetScore);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return String(left.move || "").localeCompare(String(right.move || ""));
    });

    if (candidates.length <= 1) {
      return;
    }

    if (pairMode === "best_vs_rest") {
      const best = candidates[0];

      for (let index = 1; index < candidates.length; index += 1) {
        pairs.push(createPairRecord(best, candidates[index], options));
      }

      return;
    }

    for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
        const better = Number(candidates[leftIndex].targetScore) >= Number(candidates[rightIndex].targetScore)
          ? candidates[leftIndex]
          : candidates[rightIndex];
        const worse = better === candidates[leftIndex]
          ? candidates[rightIndex]
          : candidates[leftIndex];

        pairs.push(createPairRecord(better, worse, options));
      }
    }
  });

  return pairs.filter(Boolean);
}

function createPairRecord(betterRecord, worseRecord, options) {
  const pairWeight = buildPairWeight(betterRecord, worseRecord, options);

  if (!(pairWeight > 0)) {
    return null;
  }

  return {
    betterFeatures: betterRecord.features,
    worseFeatures: worseRecord.features,
    betterMove: betterRecord.move || null,
    worseMove: worseRecord.move || null,
    betterTargetScore: Number(betterRecord.targetScore) || 0,
    worseTargetScore: Number(worseRecord.targetScore) || 0,
    betterTargetProbability: Number(betterRecord.targetProbability) || 0,
    worseTargetProbability: Number(worseRecord.targetProbability) || 0,
    pairWeight,
    featureEncoding: betterRecord.featureEncoding || worseRecord.featureEncoding || "canonical",
    positionId: betterRecord.positionId || worseRecord.positionId || null,
    rules: betterRecord.rules || worseRecord.rules || {},
    rulesKey: betterRecord.rulesKey || worseRecord.rulesKey || "classic",
    source: {
      gameId: betterRecord.source && betterRecord.source.gameId || worseRecord.source && worseRecord.source.gameId || null,
      ply: Number.isFinite(Number(betterRecord.source && betterRecord.source.ply))
        ? Number(betterRecord.source.ply)
        : (
          Number.isFinite(Number(worseRecord.source && worseRecord.source.ply))
            ? Number(worseRecord.source.ply)
            : null
        ),
      pairMode: resolvePairMode(options),
      weightMode: resolveWeightMode(options),
      searchScale: Number(options && options.searchScale) || DEFAULT_SEARCH_SCALE
    }
  };
}

function summarizePairwiseRecords(records) {
  const byRules = {};
  const positions = new Set();
  let weightSum = 0;

  records.forEach((record) => {
    const rulesKey = record.rulesKey || "classic";
    const existing = byRules[rulesKey] || {
      count: 0,
      weightSum: 0
    };

    existing.count += 1;
    existing.weightSum += Number(record.pairWeight) || 0;
    byRules[rulesKey] = existing;
    weightSum += Number(record.pairWeight) || 0;

    if (record.positionId) {
      positions.add(record.positionId);
    }
  });

  Object.keys(byRules).forEach((rulesKey) => {
    byRules[rulesKey] = {
      pairCount: byRules[rulesKey].count,
      meanPairWeight: Number((byRules[rulesKey].weightSum / byRules[rulesKey].count).toFixed(6))
    };
  });

  return {
    pairCount: records.length,
    positionCount: positions.size,
    meanPairWeight: records.length > 0 ? Number((weightSum / records.length).toFixed(6)) : 0,
    byRules
  };
}

module.exports = {
  buildPairWeight,
  createPairwiseRecords,
  resolvePairMode,
  resolveWeightMode,
  summarizePairwiseRecords
};
