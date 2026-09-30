export function normalizePronunciationText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function computePronunciationScore(scriptText: string, spokenText: string) {
  const scriptCharacters = Array.from(normalizePronunciationText(scriptText));
  const spokenCharacters = Array.from(normalizePronunciationText(spokenText));

  if (scriptCharacters.length === 0 || spokenCharacters.length === 0) return 0;

  let previousRow = Array.from({ length: spokenCharacters.length + 1 }, (_, index) => index);

  for (let i = 1; i <= scriptCharacters.length; i += 1) {
    const currentRow = [i];
    for (let j = 1; j <= spokenCharacters.length; j += 1) {
      currentRow[j] = Math.min(
        currentRow[j - 1] + 1,
        previousRow[j] + 1,
        previousRow[j - 1] + (scriptCharacters[i - 1] === spokenCharacters[j - 1] ? 0 : 1)
      );
    }
    previousRow = currentRow;
  }

  const distance = previousRow[spokenCharacters.length];
  const length = Math.max(scriptCharacters.length, spokenCharacters.length);
  return Math.max(0, Math.round(((length - distance) / length) * 100));
}