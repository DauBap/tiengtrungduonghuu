import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getLessonForAdmin } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { parseFlashcardConfig, parseListeningConfig } from "~/lib/learning-blocks";
import { WORD_TYPES, WORD_TYPE_META, parseWordType, type WordType } from "~/lib/word-types";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Overlay } from "~/components/common/overlay";
import {
  ArrowLeft, Plus, Pencil, Trash2, X, Loader2, ChevronUp, ChevronDown,
  Volume2, BookOpen, Layers, Headphones, GraduationCap, ClipboardCheck,
  Eye, Settings, BookMarked,
} from "lucide-react";
import { speakChinese } from "~/lib/speech";

type VocabRow = { id: string; chinese: string; pinyin: string; translation: string; wordType: WordType | null; audioUrl: string | null; note: string | null; order: number };
type SentenceRow = { id: string; chinese: string; pinyin: string; translation: string; audioUrl: string | null; note: string | null; order: number };
/** Ba chế độ modal dùng chung cho cả từ vựng và câu */
type VocabModalMode = "create" | "edit" | "delete" | null;

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const lesson = await getLessonForAdmin(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy bài học", { status: 404 });
  return { user, lesson };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const lessonId = params.lessonId!;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  // ── Từ vựng ──
  if (intent === "vocab-create" || intent === "vocab-edit") {
    const chinese = String(form.get("chinese") ?? "").trim();
    const pinyin = String(form.get("pinyin") ?? "").trim();
    const translation = String(form.get("translation") ?? "").trim();
    const audioUrl = String(form.get("audioUrl") ?? "").trim();
    const note = String(form.get("note") ?? "").trim();
    const wordType = parseWordType(form.get("wordType"));

    if (!chinese) return { error: "Vui lòng nhập chữ Hán", field: "chinese" };
    if (!pinyin) return { error: "Vui lòng nhập pinyin", field: "pinyin" };
    if (!translation) return { error: "Vui lòng nhập nghĩa tiếng Việt", field: "translation" };
    if (audioUrl && !/^https?:\/\/.+/i.test(audioUrl)) {
      return { error: "Link audio phải bắt đầu bằng http:// hoặc https://", field: "audioUrl" };
    }

    const data = { chinese, pinyin, translation, wordType, audioUrl: audioUrl || null, note: note || null };

    if (intent === "vocab-edit") {
      await prisma.vocabItem.update({ where: { id: String(form.get("vocabId")) }, data });
    } else {
      const last = await prisma.vocabItem.findFirst({ where: { lessonId }, orderBy: { order: "desc" }, select: { order: true } });
      await prisma.vocabItem.create({ data: { ...data, lessonId, order: (last?.order ?? 0) + 1 } });
    }
    return { success: true };
  }

  if (intent === "vocab-delete") {
    const vocabId = String(form.get("vocabId"));
    // Bỏ từ này khỏi mọi block đang tham chiếu tới nó, tránh block trỏ vào từ đã xóa
    const blocks = await prisma.learningBlock.findMany({ where: { lessonId }, select: { id: true, config: true } });
    for (const block of blocks) {
      const config = block.config as { vocabItemIds?: unknown };
      if (!Array.isArray(config?.vocabItemIds)) continue;
      const ids = config.vocabItemIds as string[];
      if (!ids.includes(vocabId)) continue;
      await prisma.learningBlock.update({
        where: { id: block.id },
        data: { config: { ...(block.config as object), vocabItemIds: ids.filter((id) => id !== vocabId) } },
      });
    }
    await prisma.vocabItem.delete({ where: { id: vocabId } });
    return { success: true };
  }

  if (intent === "vocab-move") {
    const vocabId = String(form.get("vocabId"));
    const direction = String(form.get("direction"));
    const current = await prisma.vocabItem.findUnique({ where: { id: vocabId }, select: { id: true, order: true } });
    if (!current) return { error: "Không tìm thấy từ vựng" };
    const neighbour = await prisma.vocabItem.findFirst({
      where: { lessonId, order: direction === "up" ? { lt: current.order } : { gt: current.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbour) return { success: true };
    await prisma.$transaction([
      prisma.vocabItem.update({ where: { id: current.id }, data: { order: -1 } }),
      prisma.vocabItem.update({ where: { id: neighbour.id }, data: { order: current.order } }),
      prisma.vocabItem.update({ where: { id: current.id }, data: { order: neighbour.order } }),
    ]);
    return { success: true };
  }

  // ── Câu mẫu (nguồn cho block Nghe câu) ──
  if (intent === "sentence-create" || intent === "sentence-edit") {
    const chinese = String(form.get("chinese") ?? "").trim();
    const pinyin = String(form.get("pinyin") ?? "").trim();
    const translation = String(form.get("translation") ?? "").trim();
    const audioUrl = String(form.get("audioUrl") ?? "").trim();
    const note = String(form.get("note") ?? "").trim();

    if (!chinese) return { error: "Vui lòng nhập câu tiếng Trung", field: "chinese" };
    if (!pinyin) return { error: "Vui lòng nhập pinyin", field: "pinyin" };
    if (!translation) return { error: "Vui lòng nhập nghĩa tiếng Việt", field: "translation" };
    if (audioUrl && !/^https?:\/\/.+/i.test(audioUrl)) {
      return { error: "Link audio phải bắt đầu bằng http:// hoặc https://", field: "audioUrl" };
    }

    const data = { chinese, pinyin, translation, audioUrl: audioUrl || null, note: note || null };

    if (intent === "sentence-edit") {
      await prisma.sentenceItem.update({ where: { id: String(form.get("sentenceId")) }, data });
    } else {
      const last = await prisma.sentenceItem.findFirst({ where: { lessonId }, orderBy: { order: "desc" }, select: { order: true } });
      await prisma.sentenceItem.create({ data: { ...data, lessonId, order: (last?.order ?? 0) + 1 } });
    }
    return { success: true };
  }

  if (intent === "sentence-delete") {
    const sentenceId = String(form.get("sentenceId"));
    // Bỏ câu này khỏi mọi block đang tham chiếu, tránh block trỏ vào câu đã xóa
    const blocks = await prisma.learningBlock.findMany({ where: { lessonId }, select: { id: true, config: true } });
    for (const block of blocks) {
      const config = block.config as { sentenceItemIds?: unknown };
      if (!Array.isArray(config?.sentenceItemIds)) continue;
      const ids = config.sentenceItemIds as string[];
      if (!ids.includes(sentenceId)) continue;
      await prisma.learningBlock.update({
        where: { id: block.id },
        data: { config: { ...(block.config as object), sentenceItemIds: ids.filter((id) => id !== sentenceId) } },
      });
    }
    await prisma.sentenceItem.delete({ where: { id: sentenceId } });
    return { success: true };
  }

  if (intent === "sentence-move") {
    const sentenceId = String(form.get("sentenceId"));
    const direction = String(form.get("direction"));
    const current = await prisma.sentenceItem.findUnique({ where: { id: sentenceId }, select: { id: true, order: true } });
    if (!current) return { error: "Không tìm thấy câu" };
    const neighbour = await prisma.sentenceItem.findFirst({
      where: { lessonId, order: direction === "up" ? { lt: current.order } : { gt: current.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbour) return { success: true };
    await prisma.$transaction([
      prisma.sentenceItem.update({ where: { id: current.id }, data: { order: -1 } }),
      prisma.sentenceItem.update({ where: { id: neighbour.id }, data: { order: current.order } }),
      prisma.sentenceItem.update({ where: { id: current.id }, data: { order: neighbour.order } }),
    ]);
    return { success: true };
  }

  return null;
}

// ─── Modal từ vựng ───────────────────────────────────────────────────────────

function VocabModal({ mode, vocab, onClose }: { mode: VocabModalMode; vocab: VocabRow | null; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  // Đóng modal sau khi action thành công. Phải nằm trong effect, không gọi
  // onClose() giữa lúc render (setState của cha) — và component được mount lại
  // qua `key` mỗi lần mở nên fetcher.data luôn sạch, không dính kết quả lần trước.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!mode) return null;

  if (mode === "delete") {
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">Xóa từ vựng</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>Xóa từ <strong>{vocab?.chinese}</strong> ({vocab?.translation})? Từ này cũng sẽ bị loại khỏi các dạng bài học đang dùng nó.</p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="vocab-delete" />
            <input type="hidden" name="vocabId" value={vocab?.id} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant="destructive" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa từ vựng
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  const isEdit = mode === "edit";
  return (
    <Overlay onClose={onClose}>
      <fetcher.Form method="post" noValidate className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Chỉnh sửa từ vựng" : "Thêm từ vựng"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}
        <input type="hidden" name="intent" value={isEdit ? "vocab-edit" : "vocab-create"} />
        {isEdit && <input type="hidden" name="vocabId" value={vocab?.id} />}
        <div className="space-y-2">
          <Label htmlFor="chinese">Chữ Hán <span className="text-destructive">*</span></Label>
          <Input id="chinese" name="chinese" defaultValue={vocab?.chinese} placeholder="你好" className="text-lg"
            aria-invalid={fetcher.data?.field === "chinese" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pinyin">Pinyin <span className="text-destructive">*</span></Label>
          <Input id="pinyin" name="pinyin" defaultValue={vocab?.pinyin} placeholder="nǐ hǎo" className="font-mono"
            aria-invalid={fetcher.data?.field === "pinyin" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="translation">Nghĩa tiếng Việt <span className="text-destructive">*</span></Label>
          <Input id="translation" name="translation" defaultValue={vocab?.translation} placeholder="Xin chào"
            aria-invalid={fetcher.data?.field === "translation" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wordType">Từ loại <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <select
            id="wordType"
            name="wordType"
            defaultValue={vocab?.wordType ?? ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">— Chưa xác định —</option>
            {WORD_TYPES.map((t) => (
              <option key={t} value={t}>
                {WORD_TYPE_META[t].label} ({WORD_TYPE_META[t].chinese})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="note">Ghi chú <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <Input id="note" name="note" defaultValue={vocab?.note ?? ""} placeholder="Dùng trong tình huống thân mật" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="audioUrl">Link audio <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <Input id="audioUrl" name="audioUrl" defaultValue={vocab?.audioUrl ?? ""} placeholder="https://..."
            aria-invalid={fetcher.data?.field === "audioUrl" || undefined} />
          <p className="text-xs text-muted-foreground">Để trống thì dùng giọng đọc tự động của trình duyệt.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Thêm từ vựng"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

// ─── Modal câu mẫu ───────────────────────────────────────────────────────────

function SentenceModal({ mode, sentence, onClose }: { mode: VocabModalMode; sentence: SentenceRow | null; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!mode) return null;

  if (mode === "delete") {
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">Xóa câu</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>Xóa câu <strong>{sentence?.chinese}</strong>? Câu này cũng sẽ bị loại khỏi các dạng bài học đang dùng nó.</p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="sentence-delete" />
            <input type="hidden" name="sentenceId" value={sentence?.id} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant="destructive" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa câu
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  const isEdit = mode === "edit";
  return (
    <Overlay onClose={onClose}>
      <fetcher.Form method="post" noValidate className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Chỉnh sửa câu" : "Thêm câu"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}
        <input type="hidden" name="intent" value={isEdit ? "sentence-edit" : "sentence-create"} />
        {isEdit && <input type="hidden" name="sentenceId" value={sentence?.id} />}
        <div className="space-y-2">
          <Label htmlFor="s-chinese">Câu tiếng Trung <span className="text-destructive">*</span></Label>
          <Input id="s-chinese" name="chinese" defaultValue={sentence?.chinese} placeholder="你好，我叫小明。" className="text-lg"
            aria-invalid={fetcher.data?.field === "chinese" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-pinyin">Pinyin <span className="text-destructive">*</span></Label>
          <Input id="s-pinyin" name="pinyin" defaultValue={sentence?.pinyin} placeholder="nǐ hǎo, wǒ jiào xiǎo míng." className="font-mono"
            aria-invalid={fetcher.data?.field === "pinyin" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-translation">Nghĩa tiếng Việt <span className="text-destructive">*</span></Label>
          <Input id="s-translation" name="translation" defaultValue={sentence?.translation} placeholder="Xin chào, tôi tên là Tiểu Minh."
            aria-invalid={fetcher.data?.field === "translation" || undefined} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-note">Ghi chú <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <Input id="s-note" name="note" defaultValue={sentence?.note ?? ""} placeholder="Câu giới thiệu bản thân" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-audioUrl">Link audio <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
          <Input id="s-audioUrl" name="audioUrl" defaultValue={sentence?.audioUrl ?? ""} placeholder="https://..."
            aria-invalid={fetcher.data?.field === "audioUrl" || undefined} />
          <p className="text-xs text-muted-foreground">Để trống thì dùng giọng đọc tự động của trình duyệt.</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : "Thêm câu"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

// ─── Preview cấu hình block ──────────────────────────────────────────────────

function FlashcardBlockPreview({ block, vocabCount }: { block: { config: unknown }; vocabCount: number }) {
  const parsed = parseFlashcardConfig(block.config);
  if (!parsed.ok) {
    return <p className="text-sm text-warning">Cấu hình không hợp lệ ({parsed.error}). Bấm Cài đặt để soạn lại.</p>;
  }
  const { vocabItemIds, frontSide, showPinyinOnFront, shuffle, autoSpeak } = parsed.data;
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Layers className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {vocabItemIds.length}/{vocabCount} từ vựng · mặt trước {frontSide === "chinese" ? "chữ Hán" : "nghĩa"}
        </p>
        <p className="text-sm text-muted-foreground">
          {[showPinyinOnFront && "hiện pinyin", shuffle && "xáo trộn", autoSpeak && "tự đọc"].filter(Boolean).join(" · ") || "Không có tùy chọn thêm"}
        </p>
      </div>
    </div>
  );
}

function ListeningBlockPreview({ block, vocabCount, sentenceCount }: { block: { config: unknown }; vocabCount: number; sentenceCount: number }) {
  const parsed = parseListeningConfig(block.config);
  if (!parsed.ok) {
    return <p className="text-sm text-warning">Cấu hình không hợp lệ ({parsed.error}). Bấm Cài đặt để soạn lại.</p>;
  }
  const { source, vocabItemIds, sentenceItemIds, answerMode, maxReplays } = parsed.data;
  const count = source === "sentence" ? sentenceItemIds.length : vocabItemIds.length;
  const total = source === "sentence" ? sentenceCount : vocabCount;
  return (
    <div className="flex items-center gap-3 rounded-lg border p-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Headphones className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">
          {count}/{total} {source === "sentence" ? "câu" : "từ vựng"} · nhập {answerMode === "chinese" ? "chữ Hán" : "pinyin"}
        </p>
        <p className="text-sm text-muted-foreground">
          {maxReplays > 0 ? `Tối đa ${maxReplays} lần nghe lại` : "Nghe lại không giới hạn"}
        </p>
      </div>
    </div>
  );
}

// ─── Trang ───────────────────────────────────────────────────────────────────

export default function AdminLessonDetail() {
  const { user, lesson } = useLoaderData<typeof loader>();
  const moveFetcher = useFetcher();
  const [vocabMode, setVocabMode] = useState<VocabModalMode>(null);
  const [selectedVocab, setSelectedVocab] = useState<VocabRow | null>(null);
  const [sentenceMode, setSentenceMode] = useState<VocabModalMode>(null);
  const [selectedSentence, setSelectedSentence] = useState<SentenceRow | null>(null);
  const [showAllVocab, setShowAllVocab] = useState(false);
  const [showAllSentences, setShowAllSentences] = useState(false);

  const openVocab = (mode: VocabModalMode, v: VocabRow | null = null) => { setSelectedVocab(v); setVocabMode(mode); };
  const closeVocab = useCallback(() => { setVocabMode(null); setSelectedVocab(null); }, []);
  const openSentence = (mode: VocabModalMode, s: SentenceRow | null = null) => { setSelectedSentence(s); setSentenceMode(mode); };
  const closeSentence = useCallback(() => { setSentenceMode(null); setSelectedSentence(null); }, []);

  const moveVocab = (vocabId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "vocab-move", vocabId, direction }, { method: "post" });
  const moveSentence = (sentenceId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "sentence-move", sentenceId, direction }, { method: "post" });

  const hasVocab = lesson.content.length > 0;
  const hasSentences = lesson.sentences.length > 0;
  const hasGrammar = lesson.grammarSections.length > 0;
  // Bài kiểm tra được tạo lười ở trang quản lý, nên bài chưa mở trang đó thì
  // `lesson.test` còn null — không phải là đã có bài mà rỗng câu hỏi.
  const testQuestionCount = lesson.test?.questions.length ?? 0;

  // Track các blocks hiện có theo type (unique constraint đảm bảo tối đa 1 block/type)
  const flashcardBlock = lesson.learningBlocks.find((b) => b.type === "FLASHCARD");
  const listeningBlock = lesson.learningBlocks.find((b) => b.type === "LISTENING");
  const workbookBlock = lesson.learningBlocks.find((b) => b.type === "WORKBOOK");

  return (
    <>
      <AppShell user={user}>
        <div className="space-y-6 max-w-4xl">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2">
              <Link to={`/admin/courses/${lesson.courseId}/lessons`}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại danh sách bài học
              </Link>
            </Button>
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
              <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">HSK {lesson.course.hskLevel}</span>
              <span>Bài {lesson.order}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">{lesson.title}</h1>
            <p className="text-xl text-muted-foreground font-mono mt-1">{lesson.subtitle}</p>
          </div>

          {/* Từ vựng */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      Từ vựng <span className="text-sm font-normal text-muted-foreground">({lesson.content.length})</span>
                    </CardTitle>
                  </div>
                  <CardDescription>
                    Học viên xem ở tab Từ vựng.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => openVocab("create")}>
                  <Plus className="h-4 w-4 mr-1.5" />Thêm từ
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!hasVocab ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có từ vựng</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">
                    Thêm từ vựng trước để bật tab cho học viên.
                  </p>
                  <Button size="sm" onClick={() => openVocab("create")}>
                    <Plus className="h-4 w-4 mr-1.5" />Thêm từ vựng đầu tiên
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {(showAllVocab ? lesson.content : lesson.content.slice(0, 5)).map((v, i) => (
                    <div key={v.id} className="flex items-center gap-3 rounded-lg border p-3">
                      <div className="flex flex-col">
                        <button onClick={() => moveVocab(v.id, "up")} disabled={i === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => moveVocab(v.id, "down")} disabled={i === lesson.content.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <p className="text-xl font-medium">{v.chinese}</p>
                          <p className="text-sm text-primary font-mono">{v.pinyin}</p>
                          {v.wordType && (
                            <Badge variant="outline" className="text-xs font-normal">
                              {WORD_TYPE_META[v.wordType].label}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">{v.translation}</p>
                        {v.note && <p className="text-xs text-muted-foreground italic mt-0.5">{v.note}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" title="Nghe thử"
                          onClick={() => speakChinese(v.chinese, v.audioUrl)}>
                          <Volume2 className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Sửa" onClick={() => openVocab("edit", v as VocabRow)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Xóa" onClick={() => openVocab("delete", v as VocabRow)}
                          className="hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  {lesson.content.length > 5 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full"
                      onClick={() => setShowAllVocab(!showAllVocab)}
                    >
                      {showAllVocab ? "Thu gọn" : `Xem tất cả ${lesson.content.length} từ`}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Flashcard */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Layers className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">Flashcard</CardTitle>
                  </div>
                  <CardDescription>
                    Học viên xem ở tab Flashcard. {hasVocab ? "Bấm nút bên phải để bật/cài đặt." : "Cần có từ vựng để bật Flashcard."}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" disabled={!hasVocab} asChild={hasVocab}>
                  {hasVocab ? (
                    <Link to={flashcardBlock
                      ? `/admin/lessons/${lesson.id}/blocks/${flashcardBlock.id}/edit`
                      : `/admin/lessons/${lesson.id}/blocks/new?type=FLASHCARD`}>
                      <Settings className="h-4 w-4 mr-1.5" />Cài đặt
                    </Link>
                  ) : (
                    <><Settings className="h-4 w-4 mr-1.5" />Cài đặt</>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!hasVocab ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Cần có từ vựng để bật Flashcard</p>
                  <p className="text-sm text-muted-foreground mt-1">Thêm từ vựng ở card bên trên trước.</p>
                </div>
              ) : !flashcardBlock ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Tab Flashcard chưa bật</p>
                  <p className="text-sm text-muted-foreground mt-1">Bấm &quot;Bật tab Flashcard&quot; để chọn từ vựng và cấu hình.</p>
                </div>
              ) : (
                <FlashcardBlockPreview block={flashcardBlock} vocabCount={lesson.content.length} />
              )}
            </CardContent>
          </Card>

          {/* Nghe câu */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Headphones className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">Nghe câu</CardTitle>
                  </div>
                  <CardDescription>
                    Học viên xem ở tab Nghe câu. {hasVocab || hasSentences ? "Bấm nút bên phải để bật/cài đặt." : "Cần có từ vựng hoặc câu mẫu để bật."}
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" disabled={!hasVocab && !hasSentences} asChild={hasVocab || hasSentences}>
                  {hasVocab || hasSentences ? (
                    <Link to={listeningBlock
                      ? `/admin/lessons/${lesson.id}/blocks/${listeningBlock.id}/edit`
                      : `/admin/lessons/${lesson.id}/blocks/new?type=LISTENING`}>
                      <Settings className="h-4 w-4 mr-1.5" />Cài đặt
                    </Link>
                  ) : (
                    <><Settings className="h-4 w-4 mr-1.5" />Cài đặt</>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {!hasVocab && !hasSentences ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Headphones className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Cần có từ vựng hoặc câu mẫu để bật Nghe câu</p>
                </div>
              ) : !listeningBlock ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Headphones className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Tab Nghe câu chưa bật</p>
                  <p className="text-sm text-muted-foreground mt-1">Bấm &quot;Bật tab Nghe câu&quot; để chọn nguồn và cấu hình.</p>
                </div>
              ) : (
                <ListeningBlockPreview block={listeningBlock} vocabCount={lesson.content.length} sentenceCount={lesson.sentences.length} />
              )}

              {/* Kho câu mẫu — nguồn dữ liệu cho Nghe câu, ngoài kho từ vựng đã có ở trên */}
              <div className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Kho câu mẫu <span className="text-muted-foreground font-normal">({lesson.sentences.length})</span>
                  </p>
                  <Button size="sm" variant="outline" onClick={() => openSentence("create")}>
                    <Plus className="h-4 w-4 mr-1.5" />Thêm câu
                  </Button>
                </div>
                {!hasSentences ? (
                  <p className="text-sm text-muted-foreground">Không bắt buộc — Nghe câu có thể dùng từ vựng thay thế.</p>
                ) : (
                  <div className="space-y-2">
                    {(showAllSentences ? lesson.sentences : lesson.sentences.slice(0, 5)).map((s, i) => (
                      <div key={s.id} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="flex flex-col">
                          <button onClick={() => moveSentence(s.id, "up")} disabled={i === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => moveSentence(s.id, "down")} disabled={i === lesson.sentences.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-lg font-medium">{s.chinese}</p>
                          <p className="text-sm text-primary font-mono">{s.pinyin}</p>
                          <p className="text-sm text-muted-foreground">{s.translation}</p>
                          {s.note && <p className="text-xs text-muted-foreground italic mt-0.5">{s.note}</p>}
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" title="Nghe thử"
                            onClick={() => speakChinese(s.chinese, s.audioUrl)}>
                            <Volume2 className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Sửa" onClick={() => openSentence("edit", s as SentenceRow)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Xóa" onClick={() => openSentence("delete", s as SentenceRow)}
                            className="hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                    {lesson.sentences.length > 5 && (
                      <Button variant="ghost" size="sm" className="w-full" onClick={() => setShowAllSentences(!showAllSentences)}>
                        {showAllSentences ? "Thu gọn" : `Xem tất cả ${lesson.sentences.length} câu`}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Ngữ pháp */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <GraduationCap className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">
                      Ngữ pháp <span className="text-sm font-normal text-muted-foreground">({lesson.grammarSections.length})</span>
                    </CardTitle>

                  </div>
                  <CardDescription>
                    Học viên xem ở tab Ngữ pháp.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/admin/lessons/${lesson.id}/grammar`}>
                    <GraduationCap className="h-4 w-4 mr-1.5" />Quản lý ngữ pháp
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {lesson.grammarSections.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <GraduationCap className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có phần ngữ pháp nào</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Mỗi phần gồm giải thích, công thức, ví dụ và câu hỏi luyện tập.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lesson.grammarSections.map((s, i) => (
                    <Link key={s.id} to={`/admin/lessons/${lesson.id}/grammar/${s.id}`}
                      className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors">
                      <span className="font-mono text-xs text-muted-foreground tabular-nums w-5 text-center">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{s.title}</p>
                        <p className="text-sm text-muted-foreground">
                          {s.questions.length > 0 ? `${s.questions.length} câu luyện tập` : "Chưa có câu luyện tập"}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Sách bài tập */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <BookMarked className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-base">Sách bài tập</CardTitle>
                  </div>
                  <CardDescription>
                    Học viên xem ở tab Sách bài tập. Bấm nút bên phải để bật/soạn nội dung.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to={workbookBlock
                    ? `/admin/lessons/${lesson.id}/blocks/${workbookBlock.id}/edit`
                    : `/admin/lessons/${lesson.id}/blocks/new?type=WORKBOOK`}>
                    <Settings className="h-4 w-4 mr-1.5" />Cài đặt
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!workbookBlock ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <BookMarked className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Tab Sách bài tập chưa bật</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Bấm &quot;Bật tab Sách bài tập&quot; để soạn các phần và câu hỏi bài tập.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <BookMarked className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{workbookBlock.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {(() => {
                        const cfg = workbookBlock.config as { sections?: unknown[] };
                        const count = Array.isArray(cfg?.sections) ? cfg.sections.length : 0;
                        return count > 0 ? `${count} phần bài tập` : "Chưa có phần nào — bấm Chỉnh sửa để thêm";
                      })()}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bài kiểm tra cuối bài — hệ riêng, không dùng kho câu hỏi của Bài thi */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Bài kiểm tra <span className="text-sm font-normal text-muted-foreground">({testQuestionCount})</span>
                  </CardTitle>
                  <CardDescription>
                    Học viên làm ở tab Kiểm tra, nộp một lần và phải đạt điểm sàn mới hoàn thành bài học.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/admin/lessons/${lesson.id}/test`}>
                    <ClipboardCheck className="h-4 w-4 mr-1.5" />Quản lý bài kiểm tra
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {testQuestionCount === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <ClipboardCheck className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có câu hỏi kiểm tra nào</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Chưa có câu hỏi thì tab Kiểm tra của học viên hiện mờ và không làm được.
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ClipboardCheck className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{lesson.test?.title}</p>
                    <p className="text-sm text-muted-foreground">
                      {testQuestionCount} câu · điểm đạt {lesson.test?.passScore}%
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </AppShell>
      {/* `key` ép remount mỗi lần mở modal → fetcher mới, không giữ data lần trước */}
      <VocabModal
        key={vocabMode ? `vocab-${vocabMode}-${selectedVocab?.id ?? "new"}` : "vocab-closed"}
        mode={vocabMode}
        vocab={selectedVocab}
        onClose={closeVocab}
      />
      <SentenceModal
        key={sentenceMode ? `sentence-${sentenceMode}-${selectedSentence?.id ?? "new"}` : "sentence-closed"}
        mode={sentenceMode}
        sentence={selectedSentence}
        onClose={closeSentence}
      />
    </>
  );
}
