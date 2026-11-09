function normalizeTranslationAnswer(value: string) {
  return value
    .normalize("NFC")
    .toLocaleLowerCase("vi")
    .replace(/\p{P}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestTranslationAnswerCorrect(answer: string, sampleAnswer: string): boolean | null {
  const normalizedAnswer = normalizeTranslationAnswer(answer);
  const normalizedSample = normalizeTranslationAnswer(sampleAnswer);
  if (!normalizedAnswer || !normalizedSample) return null;
  return normalizedAnswer === normalizedSample;
}
