/**
 * Đọc form config của block từ FormData và validate.
 * Dùng chung cho route tạo mới và route chỉnh sửa.
 */
import { parseBlockConfig, isLearningBlockType, type LearningBlockType } from "~/lib/learning-blocks";

export interface BlockFormResult {
  type: LearningBlockType;
  title: string;
  description: string | null;
  required: boolean;
  config: unknown;
}

export type BlockFormParse = { ok: true; data: BlockFormResult } | { ok: false; error: string; field?: string };

function bool(form: FormData, name: string) {
  return String(form.get(name) ?? "false") === "true";
}

export function parseBlockForm(form: FormData): BlockFormParse {
  const rawType = String(form.get("type") ?? "");
  if (!isLearningBlockType(rawType)) return { ok: false, error: "Dạng bài học không hợp lệ" };

  const title = String(form.get("title") ?? "").trim();
  if (!title) return { ok: false, error: "Vui lòng nhập tiêu đề", field: "title" };

  const descriptionRaw = String(form.get("description") ?? "").trim();
  const required = bool(form, "required");

  let rawConfig: unknown;
  if (rawType === "FLASHCARD") {
    const ids = String(form.get("vocabItemIds") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    rawConfig = {
      vocabItemIds: ids,
      frontSide: String(form.get("frontSide") ?? "chinese"),
      showPinyinOnFront: bool(form, "showPinyinOnFront"),
      shuffle: bool(form, "shuffle"),
      autoSpeak: bool(form, "autoSpeak"),
    };
  } else {
    // Các dạng còn lại chưa có form riêng
    return { ok: false, error: "Dạng bài học này đang được phát triển" };
  }

  const parsed = parseBlockConfig(rawType, rawConfig);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  return {
    ok: true,
    data: { type: rawType, title, description: descriptionRaw || null, required, config: parsed.data },
  };
}
