import assert from "node:assert/strict";
import test from "node:test";
import { computeTabSnapshot, isLessonTabKey } from "~/lib/lesson-tab-progress.server";

test("accepts exactly the seven supported lesson tabs", () => {
  const tabs = ["FLASHCARD", "VOCABULARY_TEST", "LISTENING", "VOCABULARY", "LESSON", "GRAMMAR", "WORKBOOK"];
  assert.ok(tabs.every((tab) => isLessonTabKey(tab)));
  assert.equal(isLessonTabKey("TEST"), false);
  assert.equal(isLessonTabKey("UNKNOWN"), false);
});

test("opened tab is in progress but not completed", () => {
  const snapshot = computeTabSnapshot({ opened: true, completed: false });
  assert.equal(snapshot.state, "IN_PROGRESS");
  assert.equal(snapshot.percent, 0);
  assert.equal(snapshot.completed, false);
});

test("completed tab has a full snapshot", () => {
  const snapshot = computeTabSnapshot({ opened: true, completed: true, percent: 100, currentScore: 82.5, bestScore: 90 });
  assert.deepEqual(snapshot, {
    state: "COMPLETED",
    percent: 100,
    completed: true,
    currentScore: 82.5,
    bestScore: 90,
  });
});

test("review state takes priority over completion", () => {
  const snapshot = computeTabSnapshot({ opened: true, completed: true, percent: 100, needsReview: true });
  assert.equal(snapshot.state, "NEEDS_REVIEW");
  assert.equal(snapshot.completed, false);
  assert.equal(snapshot.percent, 0);
});

test("scores and percentages are bounded", () => {
  const snapshot = computeTabSnapshot({ opened: true, completed: false, percent: 140, currentScore: -10, bestScore: 150 });
  assert.equal(snapshot.percent, 100);
  assert.equal(snapshot.currentScore, 0);
  assert.equal(snapshot.bestScore, 100);
  assert.equal(snapshot.completed, true);
});
