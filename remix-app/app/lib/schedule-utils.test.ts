import assert from "node:assert/strict";
import test from "node:test";
import { getScheduledSessionAvailability } from "./schedule-utils";

const mondaySchedule = [{ days: [1], startTime: "20:00", endTime: "21:30" }];

test("scheduled sessions can be created any time on the scheduled weekday in Vietnam", () => {
  assert.deepEqual(
    getScheduledSessionAvailability(mondaySchedule, "2026-11-23", new Date("2026-11-23T13:30:00.000Z")),
    { allowed: true, date: "2026-11-23" },
  );
  assert.deepEqual(
    getScheduledSessionAvailability(mondaySchedule, "2026-11-23", new Date("2026-11-23T00:01:00.000Z")),
    { allowed: true, date: "2026-11-23" },
  );
  assert.deepEqual(
    getScheduledSessionAvailability(mondaySchedule, "2026-11-23", new Date("2026-11-23T16:30:00.000Z")),
    { allowed: true, date: "2026-11-23" },
  );
});

test("scheduled sessions require the scheduled weekday and class start date", () => {
  assert.deepEqual(
    getScheduledSessionAvailability(mondaySchedule, "2026-11-23", new Date("2026-11-24T13:30:00.000Z")),
    { allowed: false, date: "2026-11-24", reason: "wrong-day" },
  );
  assert.deepEqual(
    getScheduledSessionAvailability(mondaySchedule, "2026-11-24", new Date("2026-11-23T13:30:00.000Z")),
    { allowed: false, date: "2026-11-23", reason: "before-start-date" },
  );
});

test("classes without a valid schedule cannot create scheduled sessions", () => {
  assert.deepEqual(
    getScheduledSessionAvailability([], "2026-11-23", new Date("2026-11-23T13:30:00.000Z")),
    { allowed: false, date: "2026-11-23", reason: "no-schedule" },
  );
});
