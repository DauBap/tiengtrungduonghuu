import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getLessonForAdmin } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { BLOCK_META, isLearningBlockType, type LearningBlockType } from "~/lib/learning-blocks";
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
  Volume2, BookOpen, Layers, AlertTriangle, Headphones,
} from "lucide-react";
import { cn } from "~/lib/utils";
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

  // ── Block ──
  if (intent === "block-delete") {
    await prisma.learningBlock.delete({ where: { id: String(form.get("blockId")) } });
    return { success: true };
  }

  if (intent === "block-move") {
    const blockId = String(form.get("blockId"));
    const direction = String(form.get("direction"));
    const current = await prisma.learningBlock.findUnique({ where: { id: blockId }, select: { id: true, order: true } });
    if (!current) return { error: "Không tìm thấy phần học" };
    const neighbour = await prisma.learningBlock.findFirst({
      where: { lessonId, order: direction === "up" ? { lt: current.order } : { gt: current.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbour) return { success: true };
    await prisma.$transaction([
      prisma.learningBlock.update({ where: { id: current.id }, data: { order: -1 } }),
      prisma.learningBlock.update({ where: { id: neighbour.id }, data: { order: current.order } }),
      prisma.learningBlock.update({ where: { id: current.id }, data: { order: neighbour.order } }),
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

function BlockDeleteModal({ block, onClose }: { block: { id: string; title: string } | null; onClose: () => void }) {
  const fetcher = useFetcher<{ success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!block) return null;

  return (
    <Overlay onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">Xóa dạng bài học</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <p>Xóa phần <strong>{block.title}</strong>? Tiến độ học viên đã đạt ở phần này sẽ bị xóa. Từ vựng của bài vẫn được giữ.</p>
        </div>
        <fetcher.Form method="post">
          <input type="hidden" name="intent" value="block-delete" />
          <input type="hidden" name="blockId" value={block.id} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
            <Button type="submit" variant="destructive" disabled={isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa phần này
            </Button>
          </div>
        </fetcher.Form>
      </div>
    </Overlay>
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
  const [blockToDelete, setBlockToDelete] = useState<{ id: string; title: string } | null>(null);

  const openVocab = (mode: VocabModalMode, v: VocabRow | null = null) => { setSelectedVocab(v); setVocabMode(mode); };
  const closeVocab = useCallback(() => { setVocabMode(null); setSelectedVocab(null); }, []);
  const openSentence = (mode: VocabModalMode, s: SentenceRow | null = null) => { setSelectedSentence(s); setSentenceMode(mode); };
  const closeSentence = useCallback(() => { setSentenceMode(null); setSelectedSentence(null); }, []);
  const closeBlockDelete = useCallback(() => setBlockToDelete(null), []);

  const moveVocab = (vocabId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "vocab-move", vocabId, direction }, { method: "post" });
  const moveSentence = (sentenceId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "sentence-move", sentenceId, direction }, { method: "post" });
  const moveBlock = (blockId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "block-move", blockId, direction }, { method: "post" });

  const hasVocab = lesson.content.length > 0;
  const hasSentences = lesson.sentences.length > 0;
  // Nghe câu soạn được từ kho câu, nên chỉ cần một trong hai kho có nội dung
  const canAddBlock = hasVocab || hasSentences;

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

          {/* Kho từ vựng */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Kho từ vựng <span className="text-sm font-normal text-muted-foreground">({lesson.content.length})</span>
                  </CardTitle>
                  <CardDescription>Các dạng bài học bên dưới sẽ chọn từ trong kho này.</CardDescription>
                </div>
                <Button size="sm" onClick={() => openVocab("create")}>
                  <Plus className="h-4 w-4 mr-1.5" />Thêm từ vựng
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!hasVocab ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có từ vựng</p>
                  <p className="text-sm text-muted-foreground mt-1">Thêm từ vựng trước khi tạo dạng bài học.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lesson.content.map((v, i) => (
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
                </div>
              )}
            </CardContent>
          </Card>

          {/* Kho câu mẫu */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Kho câu <span className="text-sm font-normal text-muted-foreground">({lesson.sentences.length})</span>
                  </CardTitle>
                  <CardDescription>Câu mẫu dùng cho dạng Nghe câu.</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={() => openSentence("create")}>
                  <Plus className="h-4 w-4 mr-1.5" />Thêm câu
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!hasSentences ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Headphones className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có câu nào</p>
                  <p className="text-sm text-muted-foreground mt-1">Không bắt buộc — dạng Nghe câu có thể dùng từ vựng.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {lesson.sentences.map((s, i) => (
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
                </div>
              )}
            </CardContent>
          </Card>

          {/* Dạng bài học */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Dạng bài học <span className="text-sm font-normal text-muted-foreground">({lesson.learningBlocks.length})</span>
                  </CardTitle>
                  <CardDescription>Học viên học lần lượt theo thứ tự bên dưới.</CardDescription>
                </div>
                <Button size="sm" asChild disabled={!canAddBlock}>
                  <Link to={`/admin/lessons/${lesson.id}/blocks/new`}>
                    <Plus className="h-4 w-4 mr-1.5" />Thêm dạng bài học
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!canAddBlock ? (
                <div className="rounded-lg border border-warning/30 bg-warning/5 p-4 text-sm text-warning flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Cần có ít nhất 1 từ vựng hoặc 1 câu trước khi thêm dạng bài học.</span>
                </div>
              ) : lesson.learningBlocks.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có dạng bài học nào</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">Thêm Flashcard, luyện nghe, ngữ pháp...</p>
                  <Button size="sm" asChild>
                    <Link to={`/admin/lessons/${lesson.id}/blocks/new`}>
                      <Plus className="h-4 w-4 mr-1.5" />Thêm dạng bài học
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {lesson.learningBlocks.map((b, i) => {
                    const type = isLearningBlockType(b.type) ? (b.type as LearningBlockType) : null;
                    const meta = type ? BLOCK_META[type] : null;
                    const Icon = meta?.icon ?? Layers;
                    const config = b.config as { source?: string; vocabItemIds?: unknown; sentenceItemIds?: unknown };
                    // Nghe câu có thể lấy nguồn từ kho câu, đếm theo đúng nguồn đang dùng
                    const usesSentences = config?.source === "sentence";
                    const ids = usesSentences ? config?.sentenceItemIds : config?.vocabItemIds;
                    const count = Array.isArray(ids) ? ids.length : 0;
                    const unit = usesSentences ? "câu" : "từ vựng";

                    return (
                      <div key={b.id} className="flex items-center gap-3 rounded-lg border p-3">
                        <div className="flex flex-col">
                          <button onClick={() => moveBlock(b.id, "up")} disabled={i === 0}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => moveBlock(b.id, "down")} disabled={i === lesson.learningBlocks.length - 1}
                            className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary")}>
                          <Icon className="h-4.5 w-4.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium truncate">{b.title}</p>
                            <Badge variant="outline" className="bg-muted/50 text-muted-foreground text-[10px]">
                              {meta?.label ?? b.type}
                            </Badge>
                            {!b.required && (
                              <Badge variant="outline" className="text-[10px] text-muted-foreground">Tùy chọn</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {count > 0 ? `${count} ${unit}` : `Chưa chọn ${unit}`}
                            {b.description ? ` · ${b.description}` : ""}
                          </p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" title="Sửa" asChild>
                            <Link to={`/admin/lessons/${lesson.id}/blocks/${b.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                            </Link>
                          </Button>
                          <Button variant="ghost" size="icon" title="Xóa"
                            onClick={() => setBlockToDelete({ id: b.id, title: b.title })}
                            className="hover:text-destructive hover:bg-destructive/10">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
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
      <BlockDeleteModal
        key={blockToDelete ? `block-${blockToDelete.id}` : "block-closed"}
        block={blockToDelete}
        onClose={closeBlockDelete}
      />
    </>
  );
}
