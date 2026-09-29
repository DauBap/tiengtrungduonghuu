import test from "node:test";
import assert from "node:assert/strict";

import {
  answerMatchPercent,
  answerVariants,
  bestAnswerMatchPercent,
  compareAnswerHighlights,
  isAnswerCorrectForAny,
  normalizeAnswer,
  parseAnswerVariants,
} from "./listening-answer";

test("normalizeAnswer strips punctuation and tones for pinyin", () => {
  assert.equal(normalizeAnswer("nǐ hǎo!", "pinyin"), "nihao");
  assert.equal(normalizeAnswer("你好，老师！", "chinese"), "你好老师");
});

test("compareAnswerHighlights marks matching characters in green and mismatches in red", () => {
  const matched = compareAnswerHighlights("ni hao", "nǐ hǎo", "pinyin");
  assert.deepEqual(matched.map((part) => ({ text: part.text, status: part.status })), [
    { text: "n", status: "match" },
    { text: "i", status: "match" },
    { text: "h", status: "match" },
    { text: "a", status: "match" },
    { text: "o", status: "match" },
  ]);

  const wrong = compareAnswerHighlights("ni x", "nǐ hǎo", "pinyin");
  assert.equal(wrong.some((part) => part.status === "mismatch"), true);
  assert.equal(wrong.some((part) => part.status === "match"), true);
});

test("answerMatchPercent awards partial credit after normalization", () => {
  assert.equal(answerMatchPercent("nǐ hǎo", "ni hao", "pinyin"), 100);
  assert.equal(answerMatchPercent("你好嗎", "你好吗", "chinese"), 66.67);
  assert.equal(answerMatchPercent("ni", "nihao", "pinyin"), 40);
  assert.equal(answerMatchPercent("", "nihao", "pinyin"), 0);
});

test("answer variants are parsed, deduplicated, and matched after normalization", () => {
  assert.deepEqual(parseAnswerVariants("\n你好\n您好\n你好\n", "你好"), ["您好"]);
  assert.deepEqual(answerVariants("你好", [" 您好 ", "你好"]), ["你好", "您好"]);
  assert.equal(isAnswerCorrectForAny("nǐ hǎo", ["再见", "nihao"], "pinyin"), true);
  assert.equal(bestAnswerMatchPercent("您好", ["你好", "您好"], "chinese"), 100);
});
