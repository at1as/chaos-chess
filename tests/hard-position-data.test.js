const test = require("node:test");
const assert = require("node:assert/strict");
const {
  rootCandidatesPassHardFilters,
  rootMargin,
  samplePassesHardFilters,
  teacherGap
} = require("../scripts/hard-position-data.js");

test("teacherGap computes teacher minus search score", () => {
  assert.equal(teacherGap({
    teacherScore: 40,
    searchScore: 10
  }), 30);
});

test("samplePassesHardFilters enforces minimum teacher gap", () => {
  assert.equal(samplePassesHardFilters({
    teacherScore: 30,
    searchScore: 0
  }, {
    minimumTeacherGap: 20
  }), true);
  assert.equal(samplePassesHardFilters({
    teacherScore: 10,
    searchScore: 0
  }, {
    minimumTeacherGap: 20
  }), false);
});

test("rootMargin computes best-minus-second score", () => {
  assert.equal(rootMargin([
    { score: 12 },
    { score: 3 },
    { score: -20 }
  ]), 9);
});

test("rootCandidatesPassHardFilters enforces minimum root margin", () => {
  assert.equal(rootCandidatesPassHardFilters([
    { score: 100 },
    { score: 70 }
  ], {
    minimumRootMargin: 20
  }), true);
  assert.equal(rootCandidatesPassHardFilters([
    { score: 100 },
    { score: 90 }
  ], {
    minimumRootMargin: 20
  }), false);
});
