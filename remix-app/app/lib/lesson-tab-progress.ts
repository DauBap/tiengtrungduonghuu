export const LESSON_TAB_KEYS = [
  "FLASHCARD",
  "VOCABULARY_TEST",
  "LISTENING",
  "VOCABULARY",
  "LESSON",
  "GRAMMAR",
  "WORKBOOK",
] as const;

export type LessonTab = (typeof LESSON_TAB_KEYS)[number];

export function isLessonTabKey(value: string): value is LessonTab {
  return (LESSON_TAB_KEYS as readonly string[]).includes(value);
}
