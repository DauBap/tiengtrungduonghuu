import assert from "node:assert/strict";
import test from "node:test";

import {
  comparePronunciationText,
  comparePronunciationTextParts,
  chooseClosestRecognitionCandidate,
  comparePronunciationPinyin,
  computePronunciationScore,
  mergeRecognitionTranscript,
} from "./pronunciation";

test("chooses the recognition candidate closest to the remaining pinyin script", () => {
  assert.equal(
    chooseClosestRecognitionCandidate(["他去学校", "她去上课"], "他去上课"),
    "她去上课",
  );
  assert.equal(
    chooseClosestRecognitionCandidate(["世界", "世间"], "你好世界", "你好"),
    "世界",
  );
});

test("merges recognition sessions without duplicating overlapping characters", () => {
  assert.equal(mergeRecognitionTranscript("你好", "好世界"), "你好世界");
  assert.equal(mergeRecognitionTranscript("你好", "再见"), "你好再见");
  assert.equal(mergeRecognitionTranscript("", " 你好 "), "你好");
  assert.equal(mergeRecognitionTranscript("你好", ""), "你好");
});

test("compares homophonic Chinese characters by pinyin", () => {
  assert.deepEqual(
    comparePronunciationPinyin("他去了", "她去了"),
    [
      { scriptPinyin: "tā", spokenPinyin: "tā", status: "correct" },
      { scriptPinyin: "qù", spokenPinyin: "qù", status: "correct" },
      { scriptPinyin: "le", spokenPinyin: "le", status: "correct" },
    ],
  );
});

test("treats recognized Arabic numerals as their spoken Chinese number", () => {
  assert.equal(computePronunciationScore("一百零二", "102"), 100);
  assert.equal(computePronunciationScore("二零二四年", "2024年"), 100);
  assert.equal(computePronunciationScore("一千", "1,000"), 100);
  assert.equal(computePronunciationScore("一百零二", "１０２"), 100);
  assert.equal(computePronunciationScore("两个人", "2个人"), 100);
  assert.deepEqual(
    comparePronunciationPinyin("两个人", "2个人"),
    [
      { scriptPinyin: "liǎng", spokenPinyin: "èr", status: "correct" },
      { scriptPinyin: "gè", spokenPinyin: "gè", status: "correct" },
      { scriptPinyin: "rén", spokenPinyin: "rén", status: "correct" },
    ],
  );
});

test("aligns pinyin syllables with correct, incorrect, missing, and extra speech", () => {
  assert.deepEqual(
    comparePronunciationPinyin("你好世界", "你候世"),
    [
      { scriptPinyin: "nǐ", spokenPinyin: "nǐ", status: "correct" },
      { scriptPinyin: "hǎo", spokenPinyin: "hòu", status: "incorrect" },
      { scriptPinyin: "shì", spokenPinyin: "shì", status: "correct" },
      { scriptPinyin: "jiè", spokenPinyin: null, status: "missing" },
    ],
  );
  assert.deepEqual(
    comparePronunciationPinyin("你好", "你很好"),
    [
      { scriptPinyin: "nǐ", spokenPinyin: "nǐ", status: "correct" },
      { scriptPinyin: null, spokenPinyin: "hěn", status: "extra" },
      { scriptPinyin: "hǎo", spokenPinyin: "hǎo", status: "correct" },
    ],
  );
});

test("shows tone marks without using them to decide pronunciation matches", () => {
  assert.deepEqual(
    comparePronunciationPinyin("你好", "你号"),
    [
      { scriptPinyin: "nǐ", spokenPinyin: "nǐ", status: "correct" },
      { scriptPinyin: "hǎo", spokenPinyin: "hào", status: "correct" },
    ],
  );
});

test("aligns expected and recognized Chinese text and marks both sides of mistakes", () => {
  assert.deepEqual(
    comparePronunciationText("小语你好", "小雨你好"),
    [
      { scriptCharacter: "小", spokenCharacter: "小", status: "correct" },
      { scriptCharacter: "语", spokenCharacter: "雨", status: "incorrect" },
      { scriptCharacter: "你", spokenCharacter: "你", status: "correct" },
      { scriptCharacter: "好", spokenCharacter: "好", status: "correct" },
    ],
  );
  assert.deepEqual(
    comparePronunciationText("你好世界", "你侯世"),
    [
      { scriptCharacter: "你", spokenCharacter: "你", status: "correct" },
      { scriptCharacter: "好", spokenCharacter: "侯", status: "incorrect" },
      { scriptCharacter: "世", spokenCharacter: "世", status: "correct" },
      { scriptCharacter: "界", spokenCharacter: null, status: "missing" },
    ],
  );
  assert.deepEqual(
    comparePronunciationText("你好", "你很好"),
    [
      { scriptCharacter: "你", spokenCharacter: "你", status: "correct" },
      { scriptCharacter: null, spokenCharacter: "很", status: "extra" },
      { scriptCharacter: "好", spokenCharacter: "好", status: "correct" },
    ],
  );
});

test("keeps text comparisons grouped by script part, including extra recognized characters", () => {
  assert.deepEqual(
    comparePronunciationTextParts(["你好", "世界"], "你很好师界"),
    [
      {
        scriptText: "你好",
        comparison: [
          { scriptCharacter: "你", spokenCharacter: "你", status: "correct" },
          { scriptCharacter: null, spokenCharacter: "很", status: "extra" },
          { scriptCharacter: "好", spokenCharacter: "好", status: "correct" },
        ],
      },
      {
        scriptText: "世界",
        comparison: [
          { scriptCharacter: "世", spokenCharacter: "师", status: "incorrect" },
          { scriptCharacter: "界", spokenCharacter: "界", status: "correct" },
        ],
      },
    ],
  );
});
