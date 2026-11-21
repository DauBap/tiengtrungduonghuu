import { isWordType } from "~/lib/word-types";
import { isGrammarQuestionType } from "~/lib/grammar";

export const CONTENT_CORRECTION_FIELDS = {
  VOCABULARY_ITEM: ["chinese", "chineseAlternatives", "pinyin", "pinyinAlternatives", "translation", "translationAlternatives", "wordTypes", "note"],
  SENTENCE_ITEM: ["chinese", "chineseAlternatives", "pinyin", "pinyinAlternatives", "translation", "note"],
  AUDIO_SCRIPT: ["speakers"],
  AUDIO_SPEAKER: ["chinese", "pinyin", "translation"],
  GRAMMAR_SECTION: ["title", "explanation", "formula", "examples", "note", "questions"],
  GRAMMAR_QUESTION: ["prompt", "options", "answer", "acceptedAnswers", "hint"],
  PHONETICS_QUESTION: ["given", "answer", "syllable", "answerTone", "full", "audioText"],
  LEARNING_BLOCK: ["title", "description"],
  TEST_QUESTION: ["prompt", "options", "answer", "acceptedAnswers", "hint"],
  TRANSLATION_QUESTION: ["prompt", "sampleAnswer", "acceptedAnswers", "hint"],
  COURSE_REVIEW_QUESTION: ["prompt", "answer", "acceptedAnswers", "explanation", "tokens"],
  MOCK_EXAM_QUESTION: ["prompt", "imageUrl", "audioUrl", "points"],
  MOCK_EXAM_OPTION: ["content", "imageUrl", "isCorrect"],
  QUESTION_BANK_ITEM: ["prompt", "payload", "explanation"],
  QUESTION_BANK_OPTION: ["content", "isCorrect"],
} as const;

export type ContentCorrectionTargetType = keyof typeof CONTENT_CORRECTION_FIELDS;
export type CorrectionData = Record<string, unknown>;

export interface ContentCorrectionTarget {
  type: ContentCorrectionTargetType;
  id: string;
  label: string;
  courseId: string;
  courseTitle: string;
  lessonId: string | null;
  lessonTitle: string | null;
  data: CorrectionData;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatAudioScript(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "—";
  return value.map((line, index) => {
    if (!isRecord(line)) return "";
    const speaker = typeof line.speakerName === "string" && line.speakerName ? line.speakerName : `Người ${index + 1}`;
    return [
      `${index + 1}. ${speaker}`,
      typeof line.chinese === "string" ? line.chinese : "",
      typeof line.pinyin === "string" && line.pinyin ? line.pinyin : "",
      typeof line.translation === "string" && line.translation ? line.translation : "",
    ].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

export function formatGrammarQuestions(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "Chưa có câu hỏi luyện tập.";
  return value.map((question, index) => {
    if (!isRecord(question)) return "";
    const type = isGrammarQuestionType(question.type) ? question.type : "Câu hỏi";
    const options = Array.isArray(question.options) ? question.options.join(" / ") : "";
    const acceptedAnswers = Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.join(" / ") : "";
    return [
      `${index + 1}. [${type}] ${typeof question.prompt === "string" ? question.prompt : ""}`,
      options ? `Lựa chọn / từ: ${options}` : "",
      typeof question.answer === "string" ? `Đáp án: ${question.answer}` : "",
      acceptedAnswers ? `Đáp án khác: ${acceptedAnswers}` : "",
      typeof question.hint === "string" && question.hint ? `Giải thích: ${question.hint}` : "",
    ].filter(Boolean).join("\n");
  }).filter(Boolean).join("\n\n");
}

export function serializeCorrectionData(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(serializeCorrectionData).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${serializeCorrectionData(value[key])}`,
    );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parseCorrectionProposal(
  type: ContentCorrectionTargetType,
  original: CorrectionData,
  value: unknown,
): CorrectionData | null {
  if (!isRecord(value)) return null;
  const allowedFields = CONTENT_CORRECTION_FIELDS[type];
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !allowedFields.includes(key as never))) return null;

  const proposed: CorrectionData = {};
  for (const key of keys) {
    const nextValue = value[key];
    const originalValue = original[key];
    if (key === "speakers" && type === "AUDIO_SCRIPT" && Array.isArray(originalValue)) {
      if (!Array.isArray(nextValue) || nextValue.length === 0 || nextValue.length > 200) return null;
      const originalIds = new Set(
        originalValue.flatMap((speaker) => isRecord(speaker) && typeof speaker.id === "string" ? [speaker.id] : []),
      );
      const usedIds = new Set<string>();
      const speakers: CorrectionData[] = [];
      for (const speaker of nextValue) {
        if (!isRecord(speaker)) return null;
        const fields = Object.keys(speaker);
        if (fields.some((field) => !["id", "speakerName", "chinese", "pinyin", "translation"].includes(field))) return null;
        if (speaker.id !== undefined) {
          if (typeof speaker.id !== "string" || !originalIds.has(speaker.id) || usedIds.has(speaker.id)) return null;
          usedIds.add(speaker.id);
        }
        if (
          typeof speaker.speakerName !== "string" || speaker.speakerName.length > 200 ||
          typeof speaker.chinese !== "string" || speaker.chinese.length === 0 || speaker.chinese.length > 10_000 ||
          typeof speaker.pinyin !== "string" || speaker.pinyin.length > 10_000 ||
          typeof speaker.translation !== "string" || speaker.translation.length > 10_000
        ) return null;
        speakers.push({
          ...(speaker.id ? { id: speaker.id } : {}),
          speakerName: speaker.speakerName,
          chinese: speaker.chinese,
          pinyin: speaker.pinyin,
          translation: speaker.translation,
        });
      }
      proposed[key] = speakers;
    } else if (key === "questions" && type === "GRAMMAR_SECTION" && Array.isArray(originalValue)) {
      if (!Array.isArray(nextValue) || nextValue.length !== originalValue.length || nextValue.length > 200) return null;
      const originalById = new Map(
        originalValue.flatMap((question, index) =>
          isRecord(question) && typeof question.id === "string" ? [[question.id, { question, index }] as const] : [],
        ),
      );
      const usedIds = new Set<string>();
      const questions: CorrectionData[] = [];
      for (const question of nextValue) {
        if (!isRecord(question) || typeof question.id !== "string") return null;
        const originalEntry = originalById.get(question.id);
        if (!originalEntry || usedIds.has(question.id)) return null;
        usedIds.add(question.id);
        const fields = Object.keys(question);
        if (fields.some((field) => !["id", "type", "prompt", "options", "answer", "acceptedAnswers", "hint"].includes(field))) return null;
        if (
          !isGrammarQuestionType(question.type) ||
          typeof question.prompt !== "string" || question.prompt.trim().length === 0 || question.prompt.length > 10_000 ||
          typeof question.answer !== "string" || question.answer.length > 10_000 ||
          (question.hint !== null && typeof question.hint !== "string") ||
          (typeof question.hint === "string" && question.hint.length > 10_000) ||
          !Array.isArray(question.options) || question.options.length > 200 ||
          question.options.some((option) => typeof option !== "string" || option.length > 2_000) ||
          !Array.isArray(question.acceptedAnswers) || question.acceptedAnswers.length > 200 ||
          question.acceptedAnswers.some((answer) => typeof answer !== "string" || answer.length > 2_000)
        ) return null;
        questions.push({
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          options: question.options,
          answer: question.answer,
          acceptedAnswers: question.acceptedAnswers,
          hint: question.hint,
        });
      }
      if (usedIds.size !== originalById.size) return null;
      questions.sort((left, right) =>
        (originalById.get(String(left.id))?.index ?? 0) - (originalById.get(String(right.id))?.index ?? 0),
      );
      proposed[key] = questions;
    } else if (typeof originalValue === "string" || originalValue === null) {
      if (key === "answerTone" && nextValue !== null) {
        if (typeof nextValue !== "number" || !Number.isInteger(nextValue) || nextValue < 1 || nextValue > 5) return null;
      } else if (nextValue !== null && (typeof nextValue !== "string" || nextValue.length > 10_000)) {
        return null;
      }
      proposed[key] = nextValue;
    } else if (typeof originalValue === "number") {
      if (typeof nextValue !== "number" || !Number.isFinite(nextValue)) return null;
      if (key === "answerTone" && (!Number.isInteger(nextValue) || nextValue < 1 || nextValue > 5)) return null;
      if (key === "points" && (nextValue < 0 || nextValue > 100)) return null;
      proposed[key] = nextValue;
    } else if (typeof originalValue === "boolean") {
      if (typeof nextValue !== "boolean") return null;
      proposed[key] = nextValue;
    } else if (Array.isArray(originalValue)) {
      if (!Array.isArray(nextValue) || nextValue.length > 200) {
        return null;
      }
      if (key === "wordTypes") {
        if (nextValue.some((item) => !isWordType(item)) || new Set(nextValue).size !== nextValue.length) return null;
      } else if (nextValue.some((item) => typeof item !== "string" || item.length > 2_000)) {
        return null;
      }
      proposed[key] = nextValue;
    } else if (key === "payload" && isRecord(originalValue) && isRecord(nextValue)) {
      const payloadFields = new Set(["audioUrl", "transcript", "imageUrl"]);
      if (Object.entries(nextValue).some(([field, item]) =>
        !payloadFields.has(field) || typeof item !== "string" || item.length > 10_000
      )) return null;
      const mergedPayload = { ...originalValue, ...nextValue };
      if (JSON.stringify(mergedPayload).length > 20_000) return null;
      proposed[key] = mergedPayload;
    } else {
      return null;
    }
  }
  if (Object.entries(proposed).every(([key, nextValue]) => serializeCorrectionData(original[key]) === serializeCorrectionData(nextValue))) {
    return null;
  }
  return proposed;
}

export function isContentCorrectionTargetType(value: string): value is ContentCorrectionTargetType {
  return Object.hasOwn(CONTENT_CORRECTION_FIELDS, value);
}

export function getCorrectionTargetFields(type: ContentCorrectionTargetType) {
  return CONTENT_CORRECTION_FIELDS[type];
}
