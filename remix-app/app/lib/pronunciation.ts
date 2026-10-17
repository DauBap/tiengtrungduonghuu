import { pinyin } from "pinyin-pro";

const chineseDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const numberUnits = ["", "十", "百", "千"];
const largeNumberUnits = ["", "万", "亿"];

function numberGroupToChinese(value: number) {
  const digits = String(value).padStart(4, "0");
  let result = "";
  let needsZero = false;

  for (let index = 0; index < digits.length; index += 1) {
    const digit = Number(digits[index]);
    const unit = numberUnits[digits.length - index - 1];
    if (digit === 0) {
      if (result && digits.slice(index + 1).split("").some((next) => next !== "0")) needsZero = true;
      continue;
    }
    if (needsZero) result += "零";
    needsZero = false;
    if (!(digit === 1 && unit === "十" && !result)) result += chineseDigits[digit];
    result += unit;
  }
  return result;
}

function integerToChinese(value: string) {
  const normalized = value.replace(/^0+(?=\d)/, "");
  if (normalized === "0") return chineseDigits[0];
  if (normalized.length > 12) return Array.from(normalized, (digit) => chineseDigits[Number(digit)]).join("");

  const groups: number[] = [];
  for (let end = normalized.length; end > 0; end -= 4) {
    groups.push(Number(normalized.slice(Math.max(0, end - 4), end)));
  }

  let result = "";
  let pendingZero = false;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (group === 0) {
      if (result) pendingZero = true;
      continue;
    }
    if ((pendingZero || (result && group < 1000)) && !result.endsWith("零")) result += "零";
    result += numberGroupToChinese(group) + largeNumberUnits[index];
    pendingZero = false;
  }
  return result;
}

function normalizeSpokenNumbers(text: string) {
  const normalizedText = text.replace(/[０-９]/gu, (digit) => String(digit.charCodeAt(0) - "０".charCodeAt(0)));
  return normalizedText.replace(/\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, (number, offset: number, source: string) => {
    const normalizedNumber = number.replace(/[,，]/g, "");
    if (normalizedNumber.includes(".")) {
      const [integer, decimal] = normalizedNumber.split(".");
      return `${integerToChinese(integer)}点${Array.from(decimal, (digit) => chineseDigits[Number(digit)]).join("")}`;
    }

    const nextCharacter = source[offset + number.length] ?? "";
    if (/^\d{4}$/.test(normalizedNumber) && nextCharacter === "年") {
      return Array.from(normalizedNumber, (digit) => chineseDigits[Number(digit)]).join("");
    }

    return integerToChinese(normalizedNumber);
  });
}

function normalizeSyllable(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-züv]/g, "")
    .replaceAll("ü", "u")
    .replaceAll("v", "u");
}

function textToToneMarkedPinyin(value: string) {
  return pinyin(normalizeSpokenNumbers(value), { type: "array", toneType: "symbol" })
    .filter((syllable) => normalizeSyllable(syllable));
}

function textToPinyinSyllables(value: string) {
  return textToToneMarkedPinyin(value).map(normalizeSyllable);
}

function normalizePronunciationText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function pinyinEquivalent(expected: string, actual: string) {
  return expected === actual || (expected === "er" && actual === "liang") || (expected === "liang" && actual === "er");
}

function scoreSyllables(expected: readonly string[], actual: readonly string[]) {
  if (expected.length === 0 || actual.length === 0) return 0;
  let previousRow = Array.from({ length: actual.length + 1 }, (_, index) => index);

  for (let i = 1; i <= expected.length; i += 1) {
    const currentRow = [i];
    for (let j = 1; j <= actual.length; j += 1) {
      currentRow[j] = Math.min(
        currentRow[j - 1] + 1,
        previousRow[j] + 1,
        previousRow[j - 1] + (pinyinEquivalent(expected[i - 1], actual[j - 1]) ? 0 : 1),
      );
    }
    previousRow = currentRow;
  }

  const distance = previousRow[actual.length];
  return Math.max(0, Math.round(((Math.max(expected.length, actual.length) - distance) / Math.max(expected.length, actual.length)) * 100));
}

export function chooseClosestRecognitionCandidate(
  candidates: readonly string[],
  scriptText: string,
  recognizedPrefix = "",
) {
  if (candidates.length === 0) return "";
  const expected = textToPinyinSyllables(scriptText);
  const recognizedLength = textToPinyinSyllables(recognizedPrefix).length;
  const remaining = expected.slice(recognizedLength);
  if (remaining.length === 0) return candidates[0];

  return candidates.reduce((best, candidate) => (
    scoreSyllables(remaining, textToPinyinSyllables(candidate))
      > scoreSyllables(remaining, textToPinyinSyllables(best))
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
  return `${existing}${nextCharacters.slice(overlap).join("")}`;
}

export function computePronunciationScore(scriptText: string, spokenText: string) {
  return scoreSyllables(textToPinyinSyllables(scriptText), textToPinyinSyllables(spokenText));
}

export interface PronunciationPinyinComparison {
  scriptPinyin: string | null;
  spokenPinyin: string | null;
  status: "correct" | "incorrect" | "missing" | "extra";
}

export function comparePronunciationPinyin(
  scriptText: string,
  spokenText: string,
): PronunciationPinyinComparison[] {
  const expectedPinyin = textToToneMarkedPinyin(scriptText);
  const actualPinyin = textToToneMarkedPinyin(spokenText);
  const expected = expectedPinyin.map(normalizeSyllable);
  const actual = actualPinyin.map(normalizeSyllable);
  const distances = Array.from(
    { length: expected.length + 1 },
    () => Array<number>(actual.length + 1).fill(0),
  );

  for (let i = 0; i <= expected.length; i += 1) distances[i][0] = i;
  for (let j = 0; j <= actual.length; j += 1) distances[0][j] = j;

  for (let i = 1; i <= expected.length; i += 1) {
    for (let j = 1; j <= actual.length; j += 1) {
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + (pinyinEquivalent(expected[i - 1], actual[j - 1]) ? 0 : 1),
      );
    }
  }

  const comparison: PronunciationPinyinComparison[] = [];
  let i = expected.length;
  let j = actual.length;
  while (i > 0 || j > 0) {
    if (
      i > 0
      && j > 0
      && pinyinEquivalent(expected[i - 1], actual[j - 1])
      && distances[i][j] === distances[i - 1][j - 1]
    ) {
      comparison.push({ scriptPinyin: expectedPinyin[i - 1], spokenPinyin: actualPinyin[j - 1], status: "correct" });
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && distances[i][j] === distances[i - 1][j - 1] + 1) {
      comparison.push({ scriptPinyin: expectedPinyin[i - 1], spokenPinyin: actualPinyin[j - 1], status: "incorrect" });
      i -= 1;
      j -= 1;
    } else if (i > 0 && distances[i][j] === distances[i - 1][j] + 1) {
      comparison.push({ scriptPinyin: expectedPinyin[i - 1], spokenPinyin: null, status: "missing" });
      i -= 1;
    } else {
      comparison.push({ scriptPinyin: null, spokenPinyin: actualPinyin[j - 1], status: "extra" });
      j -= 1;
    }
  }
  return comparison.reverse();
}