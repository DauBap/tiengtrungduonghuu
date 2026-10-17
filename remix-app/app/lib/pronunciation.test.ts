import assert from "node:assert/strict";
import test from "node:test";

import {
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
      { scriptPinyin: "ta", spokenPinyin: "ta", status: "correct" },
      { scriptPinyin: "qu", spokenPinyin: "qu", status: "correct" },
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
      { scriptPinyin: "liang", spokenPinyin: "er", status: "correct" },
      { scriptPinyin: "ge", spokenPinyin: "ge", status: "correct" },
      { scriptPinyin: "ren", spokenPinyin: "ren", status: "correct" },
    ],
  );
});

test("aligns pinyin syllables with correct, incorrect, missing, and extra speech", () => {
  assert.deepEqual(
    comparePronunciationPinyin("你好世界", "你候世"),
    [
      { scriptPinyin: "ni", spokenPinyin: "ni", status: "correct" },
      { scriptPinyin: "hao", spokenPinyin: "hou", status: "incorrect" },
      { scriptPinyin: "shi", spokenPinyin: "shi", status: "correct" },
      { scriptPinyin: "jie", spokenPinyin: null, status: "missing" },
    ],
  );
  assert.deepEqual(
    comparePronunciationPinyin("你好", "你很好"),
    [
      { scriptPinyin: "ni", spokenPinyin: "ni", status: "correct" },
      { scriptPinyin: null, spokenPinyin: "hen", status: "extra" },
      { scriptPinyin: "hao", spokenPinyin: "hao", status: "correct" },
    ],
  );
});
