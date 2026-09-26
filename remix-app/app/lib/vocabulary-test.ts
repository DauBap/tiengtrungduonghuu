import { WORD_TYPE_META, isWordType } from "~/lib/word-types";

export interface VocabularyTestWord {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordTypes: string[];
}

export interface VocabularyTestQuestion {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordTypeLabels: string[];
  translationOptions: string[];
  chineseOptions: string[];
}

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export function createVocabularyTest(
  lessonWords: readonly VocabularyTestWord[],
  courseWords: readonly VocabularyTestWord[]
): VocabularyTestQuestion[] {
  const translations = [...new Set(
    courseWords.map((word) => word.translation.trim()).filter(Boolean)
  )];
  const chineseWords = [...new Set(
    courseWords.map((word) => word.chinese.trim()).filter(Boolean)
  )];

  return shuffled(lessonWords.filter((word) => word.chinese.trim() && word.translation.trim())).map((word) => {
    const correct = word.translation.trim();
    const distractors = shuffled(translations.filter((translation) => translation !== correct)).slice(0, 3);
    const chineseDistractors = shuffled(chineseWords.filter((chinese) => chinese !== word.chinese.trim())).slice(0, 3);
    const wordTypeLabels = word.wordTypes
      .filter(isWordType)
      .map((type) => WORD_TYPE_META[type].label);

    return {
      id: word.id,
      chinese: word.chinese,
      pinyin: word.pinyin,
      translation: word.translation,
      wordTypeLabels,
      translationOptions: shuffled([correct, ...distractors]),
      chineseOptions: shuffled([word.chinese, ...chineseDistractors]),
    };
  });
}

export function gradeVocabularyTest(
  words: readonly VocabularyTestWord[],
  responses: FormData,
  passScore: number
) {
  let correctCount = 0;
  let blankCount = 0;
  const results = words.map((word) => {
    const given = String(responses.get(`response-${word.id}`) ?? "").trim();
    const direction = String(responses.get(`direction-${word.id}`) ?? "zh2vi") === "vi2zh" ? "vi2zh" : "zh2vi";
    const correctAnswer = direction === "vi2zh" ? word.chinese : word.translation;
    const correct = given === correctAnswer.trim();
    if (!given) blankCount++;
    if (correct) correctCount++;

    return {
      id: word.id,
      prompt: direction === "vi2zh" ? word.translation : `${word.chinese} (${word.pinyin})`,
      typeLabel: direction === "vi2zh" ? "Việt → Trung" : "Trung → Việt",
      points: 1,
      correct,
      given,
      correctAnswer,
      hint: null,
    };
  });

  const totalPoints = words.length;
  const percentage = totalPoints > 0 ? Math.round((correctCount / totalPoints) * 10000) / 100 : 0;

  return {
    percentage,
    earnedPoints: correctCount,
    totalPoints,
    correctCount,
    blankCount,
    passed: totalPoints > 0 && percentage >= passScore,
    passScore,
    questionCount: totalPoints,
    results,
  };
}