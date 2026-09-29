import assert from "node:assert/strict";
import test from "node:test";
import { createVocabularyTest } from "~/lib/vocabulary-test";

const words = [
  { id: "cat", chinese: "猫", pinyin: "māo", translation: "mèo", wordTypes: ["NOUN"] },
  { id: "dog", chinese: "狗", pinyin: "gǒu", translation: "chó", wordTypes: ["NOUN"] },
  { id: "table", chinese: "桌子", pinyin: "zhuōzi", translation: "bàn", wordTypes: ["NOUN"] },
  { id: "bird", chinese: "鸟", pinyin: "niǎo", translation: "chim", wordTypes: ["NOUN"] },
  { id: "run", chinese: "跑", pinyin: "pǎo", translation: "chạy", wordTypes: ["VERB"] },
  { id: "walk", chinese: "走", pinyin: "zǒu", translation: "đi", wordTypes: ["VERB"] },
];

test("same-type distractors are preferred when enough choices exist", () => {
  const question = createVocabularyTest([words[0]], words, true)[0];
  assert.deepEqual(new Set(question.translationOptions), new Set(["mèo", "chó", "bàn", "chim"]));
  assert.deepEqual(new Set(question.chineseOptions), new Set(["猫", "狗", "桌子", "鸟"]));
});

test("other word types fill remaining distractor slots", () => {
  const limitedPool = [words[0], words[1], words[4], words[5]];
  const question = createVocabularyTest([words[0]], limitedPool, true)[0];
  const distractors = question.translationOptions.filter((option) => option !== "mèo");
  assert.equal(distractors.length, 3);
  assert.ok(distractors.includes("chó"));
  assert.equal(distractors.filter((option) => ["chạy", "đi"].includes(option)).length, 2);
});