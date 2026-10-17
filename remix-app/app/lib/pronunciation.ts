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

export interface PronunciationCharacterComparison {
  scriptCharacter: string | null;
  spokenCharacter: string | null;
  status: "correct" | "incorrect" | "missing" | "extra";
}

export function comparePronunciationCharacters(
  scriptText: string,
  spokenText: string,
): PronunciationCharacterComparison[] {
  const scriptCharacters = Array.from(scriptText).filter((character) => normalizePronunciationText(character));
  const spokenCharacters = Array.from(spokenText).filter((character) => normalizePronunciationText(character));
  const scriptLength = scriptCharacters.length;
  const spokenLength = spokenCharacters.length;
  const distances = Array.from(
    { length: scriptLength + 1 },
    () => Array<number>(spokenLength + 1).fill(0),
  );

  for (let i = 0; i <= scriptLength; i += 1) distances[i][0] = i;
  for (let j = 0; j <= spokenLength; j += 1) distances[0][j] = j;

  for (let i = 1; i <= scriptLength; i += 1) {
    for (let j = 1; j <= spokenLength; j += 1) {
      const sameCharacter = normalizePronunciationText(scriptCharacters[i - 1])
        === normalizePronunciationText(spokenCharacters[j - 1]);
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + (sameCharacter ? 0 : 1),
      );
    }
  }

  const comparison: PronunciationCharacterComparison[] = [];
  let i = scriptLength;
  let j = spokenLength;
  while (i > 0 || j > 0) {
    if (
      i > 0
      && j > 0
      && normalizePronunciationText(scriptCharacters[i - 1]) === normalizePronunciationText(spokenCharacters[j - 1])
      && distances[i][j] === distances[i - 1][j - 1]
    ) {
      comparison.push({
        scriptCharacter: scriptCharacters[i - 1],
        spokenCharacter: spokenCharacters[j - 1],
        status: "correct",
      });
      i -= 1;
      j -= 1;
    } else if (
      i > 0
      && j > 0
      && distances[i][j] === distances[i - 1][j - 1] + 1
    ) {
      comparison.push({
        scriptCharacter: scriptCharacters[i - 1],
        spokenCharacter: spokenCharacters[j - 1],
        status: "incorrect",
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && distances[i][j] === distances[i - 1][j] + 1) {
      comparison.push({
        scriptCharacter: scriptCharacters[i - 1],
        spokenCharacter: null,
        status: "missing",
      });
      i -= 1;
    } else {
      comparison.push({
        scriptCharacter: null,
        spokenCharacter: spokenCharacters[j - 1],
        status: "extra",
      });
      j -= 1;
    }
  }

  return comparison.reverse();
}