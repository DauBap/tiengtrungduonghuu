import assert from "node:assert/strict";
import test from "node:test";

import { suggestTranslationAnswerCorrect } from "./translation-answer";

test("translation suggestions ignore case, punctuation, and repeated whitespace", () => {
  assert.equal(suggestTranslationAnswerCorrect("Tôi thích học tiếng Trung!", "tôi thích học tiếng trung。"), true);
});

test("translation suggestions still require the same words and accents", () => {
  assert.equal(suggestTranslationAnswerCorrect("Tôi thích học tiếng Anh", "Tôi thích học tiếng Trung"), false);
  assert.equal(suggestTranslationAnswerCorrect("Toi thich hoc tieng Trung", "Tôi thích học tiếng Trung"), false);
});

test("translation suggestions are unavailable when either answer is blank", () => {
  assert.equal(suggestTranslationAnswerCorrect("", "Tôi thích học tiếng Trung"), null);
  assert.equal(suggestTranslationAnswerCorrect("Tôi thích học tiếng Trung", "   "), null);
});
