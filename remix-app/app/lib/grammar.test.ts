import assert from "node:assert/strict";
import test from "node:test";
import { applyTeacherGrammarGrades } from "~/lib/grammar";

test("teacher grammar grades derive a binary score without replacing original answers", () => {
  const results = [
    { id: "q1", prompt: "Câu 1", given: "trả lời 1", correctAnswer: "đáp án 1", correct: false, points: 1 },
    { id: "q2", prompt: "Câu 2", given: "trả lời 2", correctAnswer: "đáp án 2", correct: true, points: 1 },
  ];

  const graded = applyTeacherGrammarGrades(results, [
    { questionId: "q1", correct: true, teacherFeedback: "  Đáp án chấp nhận được  " },
    { questionId: "q2", correct: false, teacherFeedback: "Thứ tự từ chưa đúng" },
  ]);

  assert.ok(graded);
  assert.equal(graded.correctCount, 1);
  assert.equal(graded.totalCount, 2);
  assert.equal(graded.score, 50);
  assert.equal(graded.passed, false);
  assert.equal(graded.results[0].given, "trả lời 1");
  assert.equal(graded.results[0].correctAnswer, "đáp án 1");
  assert.equal(graded.results[1].points, 1);
  assert.equal(graded.results[0].teacherFeedback, "Đáp án chấp nhận được");
});

test("teacher grammar grades reject incomplete, duplicated, or foreign question IDs", () => {
  const results = [
    { id: "q1", correct: true, points: 1 },
    { id: "q2", correct: false, points: 1 },
  ];
  const grade = { questionId: "q1", correct: true, teacherFeedback: "" };

  assert.equal(applyTeacherGrammarGrades(results, [grade]), null);
  assert.equal(applyTeacherGrammarGrades(results, [grade, grade]), null);
  assert.equal(applyTeacherGrammarGrades(results, [grade, { ...grade, questionId: "foreign" }]), null);
  assert.equal(applyTeacherGrammarGrades([], []), null);
});