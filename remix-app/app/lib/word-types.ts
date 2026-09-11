// Từ loại của từ vựng. Giá trị khớp enum WordType trong prisma/schema.prisma.

export const WORD_TYPES = [
  "NOUN",
  "VERB",
  "ADJECTIVE",
  "ADVERB",
  "PRONOUN",
  "NUMERAL",
  "MEASURE",
  "PREPOSITION",
  "CONJUNCTION",
  "PARTICLE",
  "INTERJECTION",
  "PHRASE",
] as const;

export type WordType = (typeof WORD_TYPES)[number];

/** Nhãn tiếng Việt + chữ Hán của từ loại, dùng cho cả admin và student. */
export const WORD_TYPE_META: Record<WordType, { label: string; short: string; chinese: string }> = {
  NOUN: { label: "Danh từ", short: "DT", chinese: "名词" },
  VERB: { label: "Động từ", short: "ĐT", chinese: "动词" },
  ADJECTIVE: { label: "Tính từ", short: "TT", chinese: "形容词" },
  ADVERB: { label: "Trạng từ", short: "TT", chinese: "副词" },
  PRONOUN: { label: "Đại từ", short: "ĐaT", chinese: "代词" },
  NUMERAL: { label: "Số từ", short: "ST", chinese: "数词" },
  MEASURE: { label: "Lượng từ", short: "LT", chinese: "量词" },
  PREPOSITION: { label: "Giới từ", short: "GT", chinese: "介词" },
  CONJUNCTION: { label: "Liên từ", short: "LiT", chinese: "连词" },
  PARTICLE: { label: "Trợ từ", short: "TrT", chinese: "助词" },
  INTERJECTION: { label: "Thán từ", short: "ThT", chinese: "叹词" },
  PHRASE: { label: "Cụm từ / mẫu câu", short: "CT", chinese: "词组" },
};

export function isWordType(value: unknown): value is WordType {
  return typeof value === "string" && (WORD_TYPES as readonly string[]).includes(value);
}

/** Đọc giá trị từ form: chuỗi rỗng / không hợp lệ → null (field tùy chọn). */
export function parseWordType(value: unknown): WordType | null {
  return isWordType(value) ? value : null;
}

/** Đọc nhiều giá trị từ form trên select multiple / checkbox. */
export function parseWordTypes(values: unknown): WordType[] {
  const list = Array.isArray(values) ? values : [values];
  const parsed = list
    .map((value) => typeof value === "string" ? value : String(value ?? ""))
    .map((value) => parseWordType(value))
    .filter((value): value is WordType => Boolean(value));
  return Array.from(new Set(parsed));
}
