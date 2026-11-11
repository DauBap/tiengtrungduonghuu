function normalizeTranslationAnswer(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/\p{P}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestTranslationAnswerCorrect(
  answer: string,
  sampleAnswer: string,
  acceptedAnswers: readonly string[] = [],
): boolean | null {
  const normalizedAnswer = normalizeTranslationAnswer(answer);
  const expectedAnswers = [sampleAnswer, ...acceptedAnswers]
    .map(normalizeTranslationAnswer)
    .filter(Boolean);
  if (!normalizedAnswer || expectedAnswers.length === 0) return null;
  return expectedAnswers.includes(normalizedAnswer);
}
