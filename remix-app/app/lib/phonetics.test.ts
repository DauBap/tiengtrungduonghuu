import test from "node:test";
import assert from "node:assert/strict";

import type { PhoneticsItem, PhoneticsSection } from "./learning-blocks";
import {
  aggregatePhoneticsSections,
  gradePhoneticsSection,
  isPhoneticsAnswerCorrect,
  normalizeFinal,
  withTone,
} from "./phonetics";

const initial: PhoneticsItem = {
  id: 1,
  type: "initial",
  given: "à",
  answer: "d",
  full: "dà",
  audioText: "dà",
};

const final: PhoneticsItem = {
  id: 2,
  type: "final",
  given: "j",
  answer: "iǎn",
  full: "jiǎn",
  audioText: "jiǎn",
};

const tone: PhoneticsItem = {
  id: 3,
  type: "tone",
  syllable: "lao",
  answerTone: 3,
  full: "lǎo",
  audioText: "lǎo",
};

test("normalizeFinal strips tone marks", () => {
  assert.equal(normalizeFinal("iǎn"), "ian");
  assert.equal(normalizeFinal("  ÀNG "), "ang");
  assert.equal(normalizeFinal("ōu"), "ou");
});

test("withTone places the mark on the right vowel", () => {
  assert.equal(withTone("lao", 3), "lǎo");
  assert.equal(withTone("neng", 2), "néng");
  assert.equal(withTone("gou", 3), "gǒu");
  assert.equal(withTone("shui", 3), "shuǐ");
});

test("initial answers ignore case and surrounding spaces", () => {
  assert.ok(isPhoneticsAnswerCorrect(initial, "d"));
  assert.ok(isPhoneticsAnswerCorrect(initial, " D "));
  assert.ok(!isPhoneticsAnswerCorrect(initial, "t"));
  assert.ok(!isPhoneticsAnswerCorrect(initial, ""));
});

test("final answers accept input typed without tone marks", () => {
  assert.ok(isPhoneticsAnswerCorrect(final, "iǎn"));
  assert.ok(isPhoneticsAnswerCorrect(final, "ian"));
  assert.ok(!isPhoneticsAnswerCorrect(final, "iang"));
});

test("tone answers accept the number as string or number", () => {
  assert.ok(isPhoneticsAnswerCorrect(tone, 3));
  assert.ok(isPhoneticsAnswerCorrect(tone, "3"));
  assert.ok(!isPhoneticsAnswerCorrect(tone, 2));
  assert.ok(!isPhoneticsAnswerCorrect(tone, null));
});

test("a blank tone answer is wrong, not accidentally zero-correct", () => {
  // Number("") === 0 nên phải chặn rõ, nếu không "" sẽ khớp answerTone 0.
  assert.ok(!isPhoneticsAnswerCorrect(tone, ""));
  assert.ok(!isPhoneticsAnswerCorrect(tone, undefined));
});

const section: PhoneticsSection = {
  id: 2,
  title: "听录音",
  description: "Nghe ghi âm",
  audio: null,
  items: [initial, final, tone],
};

test("gradePhoneticsSection scores answered and blank items", () => {
  const grade = gradePhoneticsSection(
    section,
    new Map([
      [1, "d"],
      [2, "ian"],
    ]),
  );

  assert.equal(grade.sectionId, 2);
  assert.equal(grade.correctCount, 2);
  assert.equal(grade.totalCount, 3);
  assert.equal(grade.score, 66.67);
  assert.deepEqual(
    grade.results.map((result) => ({ given: result.given, correct: result.correct })),
    [
      { given: "d", correct: true },
      { given: "ian", correct: true },
      { given: "", correct: false },
    ],
  );
});

test("gradePhoneticsSection reports the expected answer for review", () => {
  const grade = gradePhoneticsSection(section, new Map());
  assert.deepEqual(
    grade.results.map((result) => ({ prompt: result.prompt, correctAnswer: result.correctAnswer, full: result.full })),
    [
      { prompt: "Câu 1", correctAnswer: "d", full: "dà" },
      { prompt: "Câu 2", correctAnswer: "iǎn", full: "jiǎn" },
      { prompt: "Câu 3", correctAnswer: "3", full: "lǎo" },
    ],
  );
  assert.equal(grade.score, 0);
});

test("aggregatePhoneticsSections uses each section's best result and all section questions", () => {
  const grade = aggregatePhoneticsSections(
    [
      { sectionId: 1, totalCount: 9 },
      { sectionId: 2, totalCount: 9 },
      { sectionId: 3, totalCount: 9 },
    ],
    [
      { sectionId: 1, score: 88.89, correctCount: 8, completedAt: new Date("2026-10-01T10:00:00Z") },
      { sectionId: 1, score: 55.56, correctCount: 5, completedAt: new Date("2026-10-02T10:00:00Z") },
      { sectionId: 2, score: 44.44, correctCount: 4, completedAt: new Date("2026-10-03T10:00:00Z") },
    ],
  );

  assert.deepEqual(grade, { score: 44.44, correctCount: 12, totalCount: 27 });
});

test("aggregatePhoneticsSections counts unsubmitted sections in the total", () => {
  assert.deepEqual(
    aggregatePhoneticsSections(
      [
        { sectionId: 1, totalCount: 9 },
        { sectionId: 2, totalCount: 9 },
        { sectionId: 3, totalCount: 9 },
      ],
      [],
    ),
    { score: 0, correctCount: 0, totalCount: 27 },
  );
});
