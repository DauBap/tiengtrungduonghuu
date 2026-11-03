import assert from "node:assert/strict";
import test from "node:test";
import {
  getAccuracy,
  getHanziCharacters,
  getMaxUnlockedStage,
  getShenbiScopeKey,
  getStageWords,
} from "./shenbi";

test("stage slices are deterministic, one-based, and bounded by the selected vocabulary", () => {
  const words = Array.from({ length: 23 }, (_, index) => index + 1);
  assert.deepEqual(getStageWords(words, 1), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(getStageWords(words, 3), [21, 22, 23]);
  assert.deepEqual(getStageWords(words, 4), []);
  assert.deepEqual(getStageWords(words, 0), []);
});

test("lesson ranges are isolated from whole-level progress", () => {
  assert.equal(getShenbiScopeKey(null, null), "all");
  assert.equal(getShenbiScopeKey(1, 5), "1-5");
});

test("accuracy and stroke targets use the actual word counts and Hanzi characters", () => {
  assert.equal(getAccuracy(4, 1), 80);
  assert.equal(getAccuracy(0, 0), 0);
  assert.deepEqual(getHanziCharacters("北京烤鸭!"), ["北", "京", "烤", "鸭"]);
});

test("only completed stages unlock the next stage", () => {
  assert.equal(getMaxUnlockedStage([]), 1);
  assert.equal(getMaxUnlockedStage([
    { stageNumber: 1, stageCompleted: false },
    { stageNumber: 1, stageCompleted: true },
    { stageNumber: 2, stageCompleted: false },
  ]), 2);
});
