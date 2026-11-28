import assert from "node:assert/strict";
import test from "node:test";
import { shouldPromptForMidtermReview } from "./midterm-review";

test("prompts at the configured midterm session and for overdue classes", () => {
  for (const currentSessionNumber of [15, 25]) {
    assert.equal(shouldPromptForMidtermReview({
      configuredSessionNumber: 15,
      currentSessionNumber,
      hasPendingStudents: true,
      attendanceComplete: true,
    }), true);
  }
});

test("does not prompt before the milestone, without pending students, or before attendance is complete", () => {
  const base = {
    configuredSessionNumber: 15,
    currentSessionNumber: 14,
    hasPendingStudents: true,
    attendanceComplete: true,
  };
  assert.equal(shouldPromptForMidtermReview(base), false);
  assert.equal(shouldPromptForMidtermReview({
    ...base,
    currentSessionNumber: 15,
    hasPendingStudents: false,
  }), false);
  assert.equal(shouldPromptForMidtermReview({
    ...base,
    currentSessionNumber: 15,
    attendanceComplete: false,
  }), false);
  assert.equal(shouldPromptForMidtermReview({
    ...base,
    configuredSessionNumber: null,
    currentSessionNumber: 25,
  }), false);
});
