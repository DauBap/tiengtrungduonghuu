import assert from "node:assert/strict";
import test from "node:test";
import { parsePhoneticsConfig, parseWorkbookConfig } from "./learning-blocks";

function workbookQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: "q28",
    number: 28,
    kind: "input",
    prompt: "Câu trả lời",
    gradable: true,
    teacherReview: true,
    correctAnswer: "",
    ...overrides,
  };
}

function workbookConfig(question: Record<string, unknown>) {
  return {
    sections: [{
      id: "section-1",
      title: "Phần 1",
      questions: [question],
    }],
  };
}

function phoneticsConfig(audio: string | null) {
  return {
    sections: [{
      id: 1,
      title: "Nghe và luyện tập",
      audio,
      items: [{
        id: 1,
        type: "initial",
        given: "à",
        answer: "d",
        full: "dà",
        audioText: "dà",
      }],
    }],
  };
}

test("phonetics config accepts safe app upload audio paths", () => {
  const parsed = parsePhoneticsConfig(
    phoneticsConfig("/uploads/audio/phonetics/hsk1_lesson1_initials.mp3"),
  );

  assert.equal(parsed.ok, true);
});

test("phonetics config still accepts absolute audio URLs and missing audio", () => {
  assert.equal(parsePhoneticsConfig(phoneticsConfig("https://cdn.example.com/phonetics.mp3")).ok, true);
  assert.equal(parsePhoneticsConfig(phoneticsConfig(null)).ok, true);
});

test("phonetics config rejects unsafe or unrelated relative audio paths", () => {
  for (const audio of [
    "/private/audio.mp3",
    "/uploads/audio/../private.mp3",
    "/uploads/audio/%2e%2e/private.mp3",
    "/uploads/audio/file.mp3?download=1",
    "/uploads/audio/file.mp3#fragment",
  ]) {
    assert.equal(parsePhoneticsConfig(phoneticsConfig(audio)).ok, false, audio);
  }
});

test("workbook allows teacher-reviewed input questions without an answer key", () => {
  assert.equal(parseWorkbookConfig(workbookConfig(workbookQuestion())).ok, true);
});

test("workbook still requires an answer key for automatically graded questions", () => {
  assert.equal(
    parseWorkbookConfig(workbookConfig(workbookQuestion({ teacherReview: false }))).ok,
    false,
  );
});
