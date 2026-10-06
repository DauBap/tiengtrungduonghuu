function normalizeReviewAnswer(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReviewAnswerCorrect(provided: string, expectedAnswers: readonly string[]) {
  const normalizedProvided = normalizeReviewAnswer(provided);
  if (!normalizedProvided) return false;

  return expectedAnswers.some((answer) => normalizeReviewAnswer(answer) === normalizedProvided);
}
