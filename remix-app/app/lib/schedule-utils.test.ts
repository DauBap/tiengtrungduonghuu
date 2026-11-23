import assert from "node:assert/strict";
import test from "node:test";
import {
  getMissingScheduledDates,
  getScheduledDateAvailability,
  getScheduledSessionAvailability,
  getScheduledSessionNumber,
} from "./schedule-utils";

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

test("past makeup sessions must match the class weekday and start date", () => {
  assert.deepEqual(
    getScheduledDateAvailability(mondaySchedule, "2026-11-23", "2026-11-23", new Date("2026-11-25T13:30:00.000Z")),
    { allowed: true, date: "2026-11-23" },
  );
  assert.deepEqual(
    getScheduledDateAvailability(mondaySchedule, "2026-11-24", "2026-11-23", new Date("2026-11-25T13:30:00.000Z")),
    { allowed: false, date: "2026-11-23", reason: "before-start-date" },
  );
  assert.deepEqual(
    getScheduledDateAvailability(mondaySchedule, "2026-11-23", "2026-11-25", new Date("2026-11-25T13:30:00.000Z")),
    { allowed: false, date: "2026-11-25", reason: "wrong-day" },
  );
  assert.deepEqual(
    getScheduledDateAvailability(mondaySchedule, "2026-11-23", "2026-11-30", new Date("2026-11-25T13:30:00.000Z")),
    { allowed: false, date: "2026-11-30", reason: "future-date" },
  );
});

test("a missed Sunday session can be created on Monday or Tuesday before the Wednesday session", () => {
  const sundayAndWednesdaySchedule = [
    { days: [0, 3], startTime: "20:00", endTime: "21:30" },
  ];
  assert.deepEqual(
    getScheduledDateAvailability(
      sundayAndWednesdaySchedule,
      "2026-11-22",
      "2026-11-22",
      new Date("2026-11-23T13:30:00.000Z"),
    ),
    { allowed: true, date: "2026-11-22" },
  );
  assert.deepEqual(
    getScheduledDateAvailability(
      sundayAndWednesdaySchedule,
      "2026-11-22",
      "2026-11-22",
      new Date("2026-11-24T13:30:00.000Z"),
    ),
    { allowed: true, date: "2026-11-22" },
  );
  assert.deepEqual(
    getMissingScheduledDates(
      sundayAndWednesdaySchedule,
      "2026-11-22",
      "2026-11-23",
      [],
      [],
    ),
    ["2026-11-22"],
  );
});

test("missing scheduled dates exclude recorded and cancelled sessions", () => {
  const schedule = [
    { days: [1, 3, 5], startTime: "20:00", endTime: "21:30" },
  ];
  assert.deepEqual(
    getMissingScheduledDates(
      schedule,
      "2026-11-23",
      "2026-11-27",
      ["2026-11-23"],
      [],
    ),
    ["2026-11-25"],
  );
  assert.deepEqual(
    getMissingScheduledDates(
      schedule,
      "2026-11-23",
      "2026-11-27",
      [],
      ["2026-11-25"],
    ),
    ["2026-11-23"],
  );
});

test("backfilled sessions take their chronological place in the session sequence", () => {
  assert.equal(
    getScheduledSessionNumber(["2026-11-25", "2026-11-27"], "2026-11-23"),
    1,
  );
  assert.equal(
    getScheduledSessionNumber(["2026-11-23", "2026-11-27"], "2026-11-25"),
    2,
  );
  assert.equal(
    getScheduledSessionNumber(["2026-11-23", "2026-11-25"], "2026-11-27"),
    3,
  );
});
