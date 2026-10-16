export function normalizePronunciationText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function chooseClosestRecognitionCandidate(
  candidates: readonly string[],
  scriptText: string,
  recognizedPrefix = "",
) {
  if (candidates.length === 0) return "";

  const normalizedScript = Array.from(normalizePronunciationText(scriptText));
  const recognizedLength = Array.from(normalizePronunciationText(recognizedPrefix)).length;
  const remainingScript = normalizedScript.slice(recognizedLength).join("");
  if (!remainingScript) return candidates[0];

  return candidates.reduce((best, candidate) => (
    computePronunciationScore(remainingScript, candidate) > computePronunciationScore(remainingScript, best)
      ? candidate
      : best
  ));
}

export function mergeRecognitionTranscript(existingText: string, nextText: string) {
  const existing = existingText.trimEnd();
  const next = nextText.trim();
  if (!existing) return next;
  if (!next) return existing;

  const nextCharacters = Array.from(next);
  const normalizedExisting = Array.from(normalizePronunciationText(existing));
  const normalizedNext = Array.from(normalizePronunciationText(next));
  const maxOverlap = Math.min(normalizedExisting.length, normalizedNext.length);
  let overlap = 0;

  for (let length = maxOverlap; length >= 1; length -= 1) {
    const suffix = normalizedExisting.slice(-length);
    const prefix = normalizedNext.slice(0, length);
    if (suffix.every((character, index) => character === prefix[index])) {
      overlap = length;
      break;
    }
  }

  if (overlap === 0) return `${existing}${next}`;

  let normalizedCount = 0;
  let rawCharactersToRemove = 0;
  for (const character of nextCharacters) {
    rawCharactersToRemove += 1;
    normalizedCount += Array.from(normalizePronunciationText(character)).length;
    if (normalizedCount >= overlap) break;
  }

  return `${existing}${nextCharacters.slice(rawCharactersToRemove).join("")}`;
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