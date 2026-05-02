function parseOptionalNumber(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue;
}

function teacherGap(sample) {
  const teacherScore = parseOptionalNumber(sample && sample.teacherScore);
  const searchScore = parseOptionalNumber(sample && sample.searchScore);

  if (teacherScore === null || searchScore === null) {
    return null;
  }

  return teacherScore - searchScore;
}

function rootMargin(rootCandidates) {
  const candidates = Array.isArray(rootCandidates) ? rootCandidates : [];
  const numericScores = candidates
    .map((entry) => Number(entry && entry.score))
    .filter((score) => Number.isFinite(score))
    .sort((left, right) => right - left);

  if (numericScores.length <= 1) {
    return null;
  }

  return numericScores[0] - numericScores[1];
}

function samplePassesHardFilters(sample, options) {
  const minimumTeacherGap = parseOptionalNumber(options && options.minimumTeacherGap);
  const gap = teacherGap(sample);

  if (minimumTeacherGap !== null && !(gap !== null && gap >= minimumTeacherGap)) {
    return false;
  }

  return true;
}

function rootCandidatesPassHardFilters(rootCandidates, options) {
  const minimumRootMargin = parseOptionalNumber(options && options.minimumRootMargin);
  const margin = rootMargin(rootCandidates);

  if (minimumRootMargin !== null && !(margin !== null && margin >= minimumRootMargin)) {
    return false;
  }

  return true;
}

module.exports = {
  parseOptionalNumber,
  rootCandidatesPassHardFilters,
  rootMargin,
  samplePassesHardFilters,
  teacherGap
};
