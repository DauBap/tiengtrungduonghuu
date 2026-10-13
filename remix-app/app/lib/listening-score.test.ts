import test from "node:test";
import assert from "node:assert/strict";
import { getListeningGrade } from "./listening-score";

test("listening score converts percentages to points out of ten", () => {
  assert.deepEqual(getListeningGrade(72.5), {
    points: "7.3",
    message: "Khá, cố gắng lên!",
  });
});

test("listening feedback changes at the requested score thresholds", () => {
  assert.equal(getListeningGrade(49.99)?.message, "Chưa tốt lắm");
  assert.equal(getListeningGrade(50)?.message, "Khá, cố gắng lên!");
  assert.equal(getListeningGrade(79.99)?.message, "Khá, cố gắng lên!");
  assert.equal(getListeningGrade(80)?.message, "Ôi giỏi quá, gần đạt rồi!");
  assert.equal(getListeningGrade(99.99)?.message, "Ôi giỏi quá, gần đạt rồi!");
  assert.equal(getListeningGrade(100)?.message, "Chúc mừng bạn, quá tuyệt vời!");
});

test("listening grade handles missing and out-of-range scores", () => {
  assert.equal(getListeningGrade(null), null);
  assert.deepEqual(getListeningGrade(-2), {
    points: "0.0",
    message: "Chưa tốt lắm",
  });
  assert.deepEqual(getListeningGrade(120), {
    points: "10.0",
    message: "Chúc mừng bạn, quá tuyệt vời!",
  });
});
