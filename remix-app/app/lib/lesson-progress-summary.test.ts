import assert from "node:assert/strict";
import test from "node:test";
import {
  areAllAvailableActivitiesGreen,
  getGrammarActivityProgress,
  getLessonProgress,
  getLessonScriptProgress,
  isLessonProgressGreen,
} from "~/lib/lesson-progress-summary";

test("teacher green threshold is greater than 80 percent", () => {
  assert.equal(isLessonProgressGreen(80), false);
  assert.equal(isLessonProgressGreen(81), true);
});

test("lesson progress ignores unavailable activities", () => {
  const progress = getLessonProgress([
    { status: "completed", percent: 100 },
    { status: "unavailable", percent: 0 },
    { status: "missing", percent: 0 },
    { status: "unavailable", percent: 100 },
  ]);

  assert.deepEqual(progress, { percent: 50, completed: 1, total: 2 });
  assert.equal(isLessonProgressGreen(progress.percent), false);
});

test("partial activity percentages contribute to the teacher threshold", () => {
  const progress = getLessonProgress([
    { status: "completed", percent: 100 },
    { status: "completed", percent: 100 },
    { status: "partial", percent: 42 },
  ]);

  assert.equal(progress.percent, 81);
  assert.equal(isLessonProgressGreen(progress.percent), true);
});

test("completed activities use their displayed score in the lesson overview", () => {
  const progress = getLessonProgress([
    { status: "completed", percent: 100, score: 93 },
    { status: "completed", percent: 100, score: 100 },
  ]);

  assert.deepEqual(progress, { percent: 97, completed: 2, total: 2 });
});

test("partial activities use the same displayed value as the detail table", () => {
  const progress = getLessonProgress([
    { status: "partial", percent: 67, score: 35, useScoreWhenPartial: true },
    { status: "partial", percent: 20, score: 60 },
  ]);

  assert.deepEqual(progress, { percent: 28, completed: 0, total: 2 });
});

test("pending teacher grading does not count as completed progress", () => {
  const progress = getLessonProgress([
    { status: "completed", percent: 100 },
    { status: "waiting", percent: 0 },
  ]);

  assert.deepEqual(progress, { percent: 50, completed: 1, total: 2 });
  assert.equal(isLessonProgressGreen(progress.percent), false);
});

test("a lesson with no available activities does not turn green", () => {
  const progress = getLessonProgress([
    { status: "unavailable", percent: 100 },
    { status: "unavailable", percent: 100 },
  ]);

  assert.deepEqual(progress, { percent: 0, completed: 0, total: 0 });
  assert.equal(isLessonProgressGreen(progress.percent), false);
});

test("a lesson only turns green when every available activity is completed", () => {
  assert.equal(areAllAvailableActivitiesGreen([
    { status: "completed", percent: 100 },
    { status: "unavailable", percent: 0 },
  ]), true);
  assert.equal(areAllAvailableActivitiesGreen([
    { status: "completed", percent: 100 },
    { status: "partial", percent: 100 },
  ]), false);
  assert.equal(areAllAvailableActivitiesGreen([
    { status: "completed", percent: 100 },
    { status: "waiting", percent: 100 },
  ]), false);
  assert.equal(areAllAvailableActivitiesGreen([{ status: "unavailable", percent: 0 }]), false);
});

test("grammar progress requires every question group and teacher review to be complete", () => {
  const groups = [
    { sectionId: "section-1", questionType: "SINGLE_CHOICE" as const },
    { sectionId: "section-1", questionType: "FILL" as const },
    { sectionId: "section-2", questionType: "ARRANGE" as const },
  ];
  const partial = getGrammarActivityProgress(groups, [
    {
      sectionId: "section-1",
      questionType: "SINGLE_CHOICE",
      completedAt: "2026-11-03T10:00:00Z",
      reviewPending: false,
    },
    {
      sectionId: "section-1",
      questionType: "FILL",
      completedAt: "2026-11-03T10:01:00Z",
      reviewPending: true,
    },
  ]);
  assert.deepEqual(partial, { percent: 33, completed: false, waiting: true, hasStarted: true });

  const complete = getGrammarActivityProgress(groups, [
    {
      sectionId: "section-1",
      questionType: "SINGLE_CHOICE",
      completedAt: "2026-11-03T10:00:00Z",
      reviewPending: false,
    },
    {
      sectionId: "section-1",
      questionType: "FILL",
      completedAt: "2026-11-03T10:02:00Z",
      reviewPending: false,
    },
    {
      sectionId: "section-2",
      questionType: "ARRANGE",
      completedAt: "2026-11-03T10:03:00Z",
      reviewPending: false,
    },
  ]);
  assert.deepEqual(complete, { percent: 100, completed: true, waiting: false, hasStarted: true });
});

test("lesson script progress averages the best score for each script", () => {
  const progress = getLessonScriptProgress(
    ["script-1", "script-2", "script-3"],
    [
      { scriptId: "script-1", score: 80 },
      { scriptId: "script-2", score: 90 },
      { scriptId: "script-3", score: 81 },
      { scriptId: "script-1", score: 65 },
    ],
  );

  assert.deepEqual(progress, { score: 83, started: true, completed: true });
});

test("unattempted lesson scripts count as zero in the average", () => {
  const progress = getLessonScriptProgress(
    ["script-1", "script-2", "script-3"],
    [{ scriptId: "script-1", score: 90 }],
  );

  assert.deepEqual(progress, { score: 30, started: true, completed: false });
});
