import { WORD_TYPE_META, isWordType } from "~/lib/word-types";
import { answerVariants, isAnswerCorrectForAny } from "~/lib/listening-answer";

export interface VocabularyTestWord {
  id: string;
  chinese: string;
  chineseAlternatives?: string[];
  pinyin: string;
  translation: string;
  translationAlternatives?: string[];
  wordTypes: string[];
}

export interface VocabularyTestQuestion {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  lessonPinyin: string;
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
  courseWords: readonly VocabularyTestWord[],
  sameWordTypeDistractors = true
): VocabularyTestQuestion[] {
  const answerValues = (word: VocabularyTestWord, field: "translation" | "chinese") =>
    answerVariants(word[field], field === "translation" ? word.translationAlternatives : word.chineseAlternatives);

  const uniqueValues = (field: "translation" | "chinese") => {
    const byValue = new Map<string, Set<string>>();
    for (const word of courseWords) {
      for (const value of answerValues(word, field)) {
        const types = byValue.get(value) ?? new Set<string>();
        word.wordTypes.filter(isWordType).forEach((type) => types.add(type));
        byValue.set(value, types);
      }
    }
    return byValue;
  };
  const translations = uniqueValues("translation");
  const chineseWords = uniqueValues("chinese");

  const distractorsFor = (pool: Map<string, Set<string>>, word: VocabularyTestWord, correct: string[]) => {
    const needed = Math.max(0, 4 - correct.length);
    const correctSet = new Set(correct);
    const wantedTypes = new Set<string>(word.wordTypes.filter(isWordType));
    const available = [...pool].filter(([value]) => !correctSet.has(value));
    const preferred = sameWordTypeDistractors && wantedTypes.size > 0
      ? available.filter(([, types]) => [...types].some((type) => wantedTypes.has(type)))
      : [];
    const remainder = available.filter(([value]) => !preferred.some(([candidate]) => candidate === value));
    const selected = shuffled(preferred).slice(0, needed);
    if (selected.length < needed) selected.push(...shuffled(remainder).slice(0, needed - selected.length));
    return selected.map(([value]) => value);
  };

  return shuffled(lessonWords.filter((word) => word.chinese.trim() && word.translation.trim())).map((word) => {
    const translationAnswers = answerValues(word, "translation");
    const chineseAnswers = answerValues(word, "chinese");
    const distractors = distractorsFor(translations, word, translationAnswers);
    const chineseDistractors = distractorsFor(chineseWords, word, chineseAnswers);
    const wordTypeLabels = word.wordTypes
      .filter(isWordType)
      .map((type) => WORD_TYPE_META[type].label);

    return {
      id: word.id,
      chinese: word.chinese,
      pinyin: word.pinyin,
      translation: word.translation,
      lessonPinyin: word.pinyin,
      wordTypeLabels,
      translationOptions: shuffled([...translationAnswers, ...distractors]),
      chineseOptions: shuffled([...chineseAnswers, ...chineseDistractors]),
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
    const alternatives = direction === "vi2zh" ? word.chineseAlternatives : word.translationAlternatives;
    const correct = isAnswerCorrectForAny(given, answerVariants(correctAnswer, alternatives), "chinese");
    if (!given) blankCount++;
    if (correct) correctCount++;

    return {
      id: word.id,
      prompt: direction === "vi2zh" ? word.translation : word.chinese,
      lessonPinyin: word.pinyin,
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