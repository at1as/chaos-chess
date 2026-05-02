const {
  DEFAULT_SEARCH_SCALE,
  normalizeSearchScore,
  rulesKeyFromRules
} = require("./ml-data.js");

function resolveScoreField(options) {
  return options && options.scoreField === "targetScore" ? "targetScore" : "targetScoreDelta";
}

function createCandidateScoreRecord(sample, options) {
  const scoreField = resolveScoreField(options);
  const rawScore = Number(sample && sample[scoreField]);
  const searchScale = Number(options && options.searchScale) || DEFAULT_SEARCH_SCALE;

  if (!sample || !Array.isArray(sample.features) || !Number.isFinite(rawScore)) {
    return null;
  }

  return {
    features: sample.features,
    featureEncoding: sample.featureEncoding || "canonical",
    targetValue: normalizeSearchScore(rawScore, searchScale),
    searchValue: normalizeSearchScore(rawScore, searchScale),
    outcome: 0,
    rules: sample.rules || {},
    rulesKey: rulesKeyFromRules(sample.rules || {}),
    positionId: sample.positionId || null,
    move: sample.move || null,
    isTeacherBest: sample.isTeacherBest ? 1 : 0,
    source: {
      gameId: sample.source && sample.source.gameId || null,
      ply: Number.isFinite(Number(sample.source && sample.source.ply))
        ? Number(sample.source.ply)
        : null,
      engine: sample.source && sample.source.engine || null,
      teacherEngine: sample.source && sample.source.teacherEngine || null,
      teacherDepth: Number.isFinite(Number(sample.source && sample.source.teacherDepth))
        ? Number(sample.source.teacherDepth)
        : null,
      teacherNodes: Number.isFinite(Number(sample.source && sample.source.teacherNodes))
        ? Number(sample.source.teacherNodes)
        : null,
      distillTemperature: Number.isFinite(Number(sample.source && sample.source.distillTemperature))
        ? Number(sample.source.distillTemperature)
        : null,
      legalMoveCount: Number.isFinite(Number(sample.legalMoveCount))
        ? Number(sample.legalMoveCount)
        : null,
      scoreField,
      searchScale
    }
  };
}

function summarizeCandidateScoreRecords(records) {
  const byRules = {};
  const positions = new Set();
  let targetSum = 0;
  let teacherBestCount = 0;

  records.forEach((record) => {
    const rulesKey = record.rulesKey || "classic";
    const existing = byRules[rulesKey] || {
      count: 0,
      teacherBestCount: 0,
      meanTarget: 0
    };

    existing.count += 1;
    existing.teacherBestCount += record.isTeacherBest ? 1 : 0;
    existing.meanTarget += record.targetValue;
    byRules[rulesKey] = existing;
    targetSum += record.targetValue;
    teacherBestCount += record.isTeacherBest ? 1 : 0;

    if (record.positionId) {
      positions.add(record.positionId);
    }
  });

  Object.keys(byRules).forEach((rulesKey) => {
    byRules[rulesKey] = {
      sampleCount: byRules[rulesKey].count,
      teacherBestCount: byRules[rulesKey].teacherBestCount,
      meanTargetValue: Number((byRules[rulesKey].meanTarget / byRules[rulesKey].count).toFixed(6))
    };
  });

  return {
    sampleCount: records.length,
    positionCount: positions.size,
    teacherBestCount: teacherBestCount,
    teacherBestRate: records.length > 0 ? Number((teacherBestCount / records.length).toFixed(6)) : 0,
    meanTargetValue: records.length > 0 ? Number((targetSum / records.length).toFixed(6)) : 0,
    byRules
  };
}

module.exports = {
  createCandidateScoreRecord,
  resolveScoreField,
  summarizeCandidateScoreRecords
};
