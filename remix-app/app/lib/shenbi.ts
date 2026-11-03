export interface ShenbiVocabularyItem {
  id: string;
  chinese: string;
  chineseAlternatives: string[];
  pinyin: string;
  pinyinAlternatives: string[];
  translation: string;
  translationAlternatives: string[];
  audioUrl: string | null;
  lesson: number;
}

export interface ShenbiLesson {
  order: number;
  title: string;
  wordCount: number;
}

export interface ShenbiLevel {
  level: number;
  courseCode: string;
  title: string;
  lessons: ShenbiLesson[];
  words: ShenbiVocabularyItem[];
}

export function getShenbiScopeKey(lessonFrom: number | null, lessonTo: number | null): string {
  if (lessonFrom === null || lessonTo === null) return "all";
  return `${lessonFrom}-${lessonTo}`;
}

export function getStageWords<T>(words: T[], stageNumber: number, stageSize = 10): T[] {
  if (!Number.isInteger(stageNumber) || stageNumber < 1 || !Number.isInteger(stageSize) || stageSize < 1) {
    return [];
  }
  const start = (stageNumber - 1) * stageSize;
  return words.slice(start, start + stageSize);
}

export function getAccuracy(correctCount: number, missedCount: number): number {
  const total = correctCount + missedCount;
  return total === 0 ? 0 : Math.round((correctCount / total) * 100);
}

export function getHanziCharacters(word: string): string[] {
  return [...word].filter((character) => /\p{Script=Han}/u.test(character));
}

export function getMaxUnlockedStage(
  attempts: Array<{ stageNumber: number; stageCompleted: boolean }>,
): number {
  return attempts.reduce(
    (max, attempt) => attempt.stageCompleted ? Math.max(max, attempt.stageNumber + 1) : max,
    1,
  );
}
