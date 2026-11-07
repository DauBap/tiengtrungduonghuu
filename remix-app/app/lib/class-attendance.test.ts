import assert from "node:assert/strict";
import test from "node:test";
import { getClassAttendanceSummary } from "./class-attendance";

test("class attendance counts present and late sessions as attended", () => {
  assert.deepEqual(
    getClassAttendanceSummary(["PRESENT", "LATE", "ABSENT", null]),
    { attendedSessions: 2, totalSessions: 4, percentage: 50 },
  );
});

test("class attendance handles classes without sessions", () => {
  assert.deepEqual(
    getClassAttendanceSummary([]),
    { attendedSessions: 0, totalSessions: 0, percentage: 0 },
  );
});
