import test from "node:test";
import assert from "node:assert/strict";

import { isReviewAnswerCorrect } from "./review-answer";

test("review grading preserves Chinese characters and ignores punctuation", () => {
  assert.equal(isReviewAnswerCorrect("你好妈？", ["你好妈？"]), true);
  assert.equal(isReviewAnswerCorrect("我叫白家月", ["我叫白家月。"]), true);
});

test("review grading accepts Vietnamese without tone marks", () => {
  assert.equal(isReviewAnswerCorrect("Toi ten la Bach Gia Nguyet", ["Tôi tên là Bạch Gia Nguyệt."]), true);
});

test("review grading does not accept partial or empty answers", () => {
  assert.equal(isReviewAnswerCorrect("我叫", ["我叫白家月"]), false);
  assert.equal(isReviewAnswerCorrect("", ["我叫白家月"]), false);
});
