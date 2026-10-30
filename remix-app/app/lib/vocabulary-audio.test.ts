import assert from "node:assert/strict";
import test from "node:test";
import { getVocabularyAudioUrl } from "./vocabulary-audio";

test("HSK1-3 lesson 1 recordings use URL-encoded public audio paths", () => {
  assert.equal(
    getVocabularyAudioUrl("HSK1-3.0", 1, "再见"),
    "/uploads/audio/vocab/hsk1-3/lesson-01/%E5%86%8D%E8%A7%81.MP3",
  );
  assert.equal(
    getVocabularyAudioUrl("HSK1-3.0", 1, "不客气"),
    "/uploads/audio/vocab/hsk1-3/lesson-01/%E4%B8%8D%E5%AE%A2%E6%B0%94.MP3",
  );
});

test("recorded audio mapping does not affect other courses, lessons, or words", () => {
  assert.equal(getVocabularyAudioUrl("HSK-1", 1, "你好"), null);
  assert.equal(getVocabularyAudioUrl("HSK1-3.0", 2, "你好"), null);
  assert.equal(getVocabularyAudioUrl("HSK1-3.0", 1, "你好呀"), null);
});
