/**
 * Đọc form config của block từ FormData và validate.
 * Dùng chung cho route tạo mới và route chỉnh sửa.
 */
import { parseBlockConfig, isLearningBlockType, type LearningBlockType } from "~/lib/learning-blocks";
import { prisma } from "~/lib/prisma.server";

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

/** Đọc danh sách id gửi dưới dạng chuỗi phân tách bằng dấu phẩy */
function idList(form: FormData, name: string): string[] {
  return String(form.get(name) ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
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
    rawConfig = {
      vocabItemIds: idList(form, "vocabItemIds"),
      frontSide: String(form.get("frontSide") ?? "chinese"),
      showPinyinOnFront: bool(form, "showPinyinOnFront"),
      shuffle: bool(form, "shuffle"),
      autoSpeak: bool(form, "autoSpeak"),
    };
  } else if (rawType === "LISTENING") {
    rawConfig = {
      source: String(form.get("source") ?? "vocab"),
      vocabItemIds: idList(form, "vocabItemIds"),
      sentenceItemIds: idList(form, "sentenceItemIds"),
      answerMode: String(form.get("answerMode") ?? "chinese"),
      maxReplays: Number(form.get("maxReplays") ?? 0) || 0,
      shuffle: bool(form, "shuffle"),
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

/**
 * Lọc id trong config, chỉ giữ nội dung thuộc đúng bài học.
 *
 * Client gửi id qua hidden input nên có thể bị sửa để trỏ sang bài khác — phải
 * đối chiếu với DB. Sửa `config` tại chỗ để caller lưu thẳng vào DB.
 */
export async function keepOwnedIds(
  lessonId: string,
  type: LearningBlockType,
  config: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = config as { source?: string; vocabItemIds?: string[]; sentenceItemIds?: string[] };

  if (c.vocabItemIds?.length) {
    const owned = await prisma.vocabItem.findMany({
      where: { lessonId, id: { in: c.vocabItemIds } },
      select: { id: true },
    });
    const ids = new Set(owned.map((v) => v.id));
    c.vocabItemIds = c.vocabItemIds.filter((id) => ids.has(id));
  }

  if (c.sentenceItemIds?.length) {
    const owned = await prisma.sentenceItem.findMany({
      where: { lessonId, id: { in: c.sentenceItemIds } },
      select: { id: true },
    });
    const ids = new Set(owned.map((s) => s.id));
    c.sentenceItemIds = c.sentenceItemIds.filter((id) => ids.has(id));
  }

  // Nguồn đang dùng phải còn ít nhất 1 mục, nếu không block sẽ trống và học
  // viên không thể hoàn thành phần bắt buộc.
  if (type === "FLASHCARD" && !c.vocabItemIds?.length) {
    return { ok: false, error: "Chọn ít nhất 1 từ vựng cho thẻ" };
  }
  if (type === "LISTENING") {
    const used = c.source === "sentence" ? c.sentenceItemIds : c.vocabItemIds;
    if (!used?.length) return { ok: false, error: "Chọn ít nhất 1 câu hỏi cho phần nghe" };
  }

  return { ok: true };
}
