import { useCallback, useEffect, useState } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import {
  GRAMMAR_QUESTION_TYPES, GRAMMAR_QUESTION_META, parseGrammarQuestionType,
  grammarAnswerText, type GrammarQuestionType,
} from "~/lib/grammar";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import { Textarea } from "~/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Overlay } from "~/components/common/overlay";
import {
  ArrowLeft, Plus, Pencil, Trash2, X, Loader2, ChevronUp, ChevronDown,
  ListChecks, Check, CircleDot,
} from "lucide-react";
import { cn } from "~/lib/utils";

type QuestionRow = {
  id: string;
  type: GrammarQuestionType;
  prompt: string;
  options: string[];
  answer: string;
  hint: string | null;
  order: number;
};

type ModalMode = "create" | "edit" | "delete" | null;

/** Nội dung một câu hỏi sau khi đã kiểm, sẵn sàng ghi vào DB */
type ParsedQuestion = {
  type: GrammarQuestionType;
  prompt: string;
  options: string[];
  answer: string;
  hint: string | null;
};

/** Số câu tối đa gửi được trong một lần — chặn form bị nhồi bất thường */
const MAX_QUESTIONS_PER_SUBMIT = 30;

/**
 * Đọc câu hỏi thứ `index` trong form. Một lần gửi có thể mang nhiều câu nên
 * mọi field đều có hậu tố `-index`; `field` trả về cũng mang hậu tố đó để phía
 * client biết ô nào cần tô đỏ.
 *
 * `total` chỉ dùng để quyết định có thêm tiền tố "Câu N:" vào thông báo lỗi —
 * gửi một câu thì tiền tố đó chỉ gây rối.
 */
function parseQuestionAt(
  form: FormData,
  index: number,
  type: GrammarQuestionType,
  total: number
): { ok: true; data: ParsedQuestion } | { ok: false; error: string; field?: string } {
  const at = (name: string) => `${name}-${index}`;
  const label = (message: string) => (total > 1 ? `Câu ${index + 1}: ${message}` : message);
  const fail = (message: string, field?: string) =>
    ({ ok: false as const, error: label(message), field: field ? at(field) : undefined });

  const prompt = String(form.get(at("prompt")) ?? "").trim();
  if (!prompt) return fail("Vui lòng nhập câu hỏi", "prompt");

  const hint = String(form.get(at("hint")) ?? "").trim() || null;

  // Lựa chọn gửi bằng nhiều input cùng tên — nội dung có thể chứa dấu phẩy nên
  // không gộp thành một chuỗi được.
  // KHÔNG lọc ô trống: `correctIndex` là vị trí trong danh sách client gửi lên,
  // lọc bớt sẽ làm lệch index và đánh dấu sai đáp án.
  const options = form.getAll(at("option")).map((o) => String(o).trim());

  if (type === "SINGLE_CHOICE" || type === "ARRANGE") {
    if (options.some((o) => !o)) {
      return fail(
        type === "SINGLE_CHOICE" ? "Không được để trống lựa chọn nào" : "Không được để trống từ nào",
        "options"
      );
    }
  }

  if (type === "SINGLE_CHOICE") {
    if (options.length < 2) return fail("Cần ít nhất 2 lựa chọn", "options");
    if (new Set(options).size !== options.length) {
      // Đáp án lưu bằng nội dung, hai lựa chọn trùng nhau thì không biết đâu là đúng
      return fail("Các lựa chọn không được trùng nội dung", "options");
    }
    const correctIndex = Number(form.get(at("correctIndex")) ?? -1);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return fail("Chọn đáp án đúng", "options");
    }
    return { ok: true, data: { type, prompt, options, answer: options[correctIndex], hint } };
  }

  if (type === "ARRANGE") {
    if (options.length < 2) return fail("Cần ít nhất 2 từ để sắp xếp", "options");
    return { ok: true, data: { type, prompt, options, answer: options.join(""), hint } };
  }

  const answer = String(form.get(at("answer")) ?? "").trim();
  if (!answer) return fail("Vui lòng nhập đáp án", "answer");
  return { ok: true, data: { type, prompt, options: [], answer, hint } };
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  // Lọc theo cả lessonId: không cho sửa câu hỏi của bài khác bằng cách đổi URL
  const section = await prisma.grammarSection.findFirst({
    where: { id: params.sectionId!, lessonId: params.lessonId! },
    include: {
      questions: { orderBy: { order: "asc" } },
      lesson: { select: { id: true, order: true, title: true } },
    },
  });
  if (!section) throw new Response("Không tìm thấy phần ngữ pháp", { status: 404 });
  return { user, section };
}

export async function action({ request, params }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const sectionId = params.sectionId!;
  const form = await request.formData();
  const intent = String(form.get("intent"));

  const section = await prisma.grammarSection.findFirst({
    where: { id: sectionId, lessonId: params.lessonId! },
    select: { id: true },
  });
  if (!section) throw new Response("Không tìm thấy phần ngữ pháp", { status: 404 });

  if (intent === "question-create" || intent === "question-edit") {
    const type = parseGrammarQuestionType(form.get("type"));
    if (!type) return { error: "Dạng câu hỏi không hợp lệ" };

    // Sửa thì luôn một câu; thêm mới thì admin soạn được nhiều câu cùng dạng
    // trong một lần, `count` cho biết form gửi lên bao nhiêu câu.
    const count = intent === "question-edit" ? 1 : Number(form.get("count") ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > MAX_QUESTIONS_PER_SUBMIT) {
      return { error: "Số câu hỏi không hợp lệ" };
    }

    // Kiểm hết trước khi ghi: một câu sai thì không câu nào được tạo, tránh để
    // lại nửa vời rồi admin phải tự đoán câu nào đã vào
    const parsed: ParsedQuestion[] = [];
    for (let i = 0; i < count; i++) {
      const result = parseQuestionAt(form, i, type, count);
      if (!result.ok) return { error: result.error, field: result.field };
      parsed.push(result.data);
    }

    if (intent === "question-edit") {
      const questionId = String(form.get("questionId"));
      const owned = await prisma.grammarQuestion.findFirst({
        where: { id: questionId, sectionId }, select: { id: true },
      });
      if (!owned) return { error: "Không tìm thấy câu hỏi" };
      await prisma.grammarQuestion.update({ where: { id: questionId }, data: parsed[0] });
      return { success: true, created: 1 };
    }

    const last = await prisma.grammarQuestion.findFirst({
      where: { sectionId }, orderBy: { order: "desc" }, select: { order: true },
    });
    const baseOrder = last?.order ?? 0;
    await prisma.grammarQuestion.createMany({
      data: parsed.map((q, i) => ({ ...q, sectionId, order: baseOrder + i + 1 })),
    });
    return { success: true, created: parsed.length };
  }

  if (intent === "question-delete") {
    const result = await prisma.grammarQuestion.deleteMany({
      where: { id: String(form.get("questionId")), sectionId },
    });
    if (result.count === 0) return { error: "Không tìm thấy câu hỏi" };
    return { success: true };
  }

  if (intent === "question-move") {
    const questionId = String(form.get("questionId"));
    const direction = String(form.get("direction"));
    const current = await prisma.grammarQuestion.findFirst({
      where: { id: questionId, sectionId }, select: { id: true, order: true },
    });
    if (!current) return { error: "Không tìm thấy câu hỏi" };
    const neighbour = await prisma.grammarQuestion.findFirst({
      where: { sectionId, order: direction === "up" ? { lt: current.order } : { gt: current.order } },
      orderBy: { order: direction === "up" ? "desc" : "asc" },
      select: { id: true, order: true },
    });
    if (!neighbour) return { success: true };
    await prisma.$transaction([
      prisma.grammarQuestion.update({ where: { id: current.id }, data: { order: -1 } }),
      prisma.grammarQuestion.update({ where: { id: neighbour.id }, data: { order: current.order } }),
      prisma.grammarQuestion.update({ where: { id: current.id }, data: { order: neighbour.order } }),
    ]);
    return { success: true };
  }

  return null;
}

// ─── Modal ───────────────────────────────────────────────────────────────────

/** Một câu đang soạn trong form. `options`/`correctIndex` chỉ dùng theo dạng đã chọn. */
type Draft = {
  prompt: string;
  options: string[];
  correctIndex: number;
  answer: string;
  hint: string;
};

function emptyDraft(): Draft {
  return { prompt: "", options: ["", ""], correctIndex: 0, answer: "", hint: "" };
}

function draftFrom(question: QuestionRow): Draft {
  const found = question.options.indexOf(question.answer);
  return {
    prompt: question.prompt,
    options: question.options.length > 0 ? question.options : ["", ""],
    correctIndex: found >= 0 ? found : 0,
    answer: question.answer,
    hint: question.hint ?? "",
  };
}

/**
 * Form soạn một câu. Mọi field mang hậu tố `-index` để một lần gửi chở được
 * nhiều câu; server đọc lại bằng cùng quy ước (xem `parseQuestionAt`).
 */
function DraftFields({
  index, draft, type, invalidField, onChange, showTitle, onRemove,
}: {
  index: number;
  draft: Draft;
  type: GrammarQuestionType;
  invalidField?: string;
  onChange: (patch: Partial<Draft>) => void;
  showTitle: boolean;
  onRemove?: () => void;
}) {
  const usesOptions = type === "SINGLE_CHOICE" || type === "ARRANGE";
  const at = (name: string) => `${name}-${index}`;
  const isInvalid = (name: string) => invalidField === at(name) || undefined;

  const setOption = (i: number, value: string) =>
    onChange({ options: draft.options.map((o, j) => (j === i ? value : o)) });

  const removeOption = (i: number) =>
    onChange({
      options: draft.options.filter((_, j) => j !== i),
      // Đáp án đúng lưu bằng vị trí, xóa ô phía trên thì phải dịch theo
      correctIndex: i < draft.correctIndex ? draft.correctIndex - 1 : i === draft.correctIndex ? 0 : draft.correctIndex,
    });

  return (
    <div className={cn("space-y-4", showTitle && "rounded-lg border p-4")}>
      <input type="hidden" name={at("correctIndex")} value={String(draft.correctIndex)} />

      {showTitle && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Câu {index + 1}</span>
          {onRemove && (
            <Button type="button" variant="ghost" size="sm" onClick={onRemove}
              className="h-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10">
              <X className="h-3.5 w-3.5 mr-1" />Bỏ câu này
            </Button>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={at("prompt")}>Câu hỏi <span className="text-destructive">*</span></Label>
        <Textarea id={at("prompt")} name={at("prompt")} value={draft.prompt} rows={2}
          onChange={(e) => onChange({ prompt: e.target.value })}
          placeholder={type === "ARRANGE" ? "Sắp xếp thành câu đúng" : "Chọn câu đúng ngữ pháp"}
          aria-invalid={isInvalid("prompt")} />
      </div>

      {usesOptions && (
        <div className="space-y-2">
          <Label>
            {type === "SINGLE_CHOICE" ? "Các lựa chọn" : "Các từ theo thứ tự đúng"}
            <span className="text-destructive"> *</span>
          </Label>
          <p className="text-xs text-muted-foreground">
            {type === "SINGLE_CHOICE"
              ? "Bấm vòng tròn bên trái để đánh dấu đáp án đúng."
              : "Nhập theo đúng thứ tự của câu — học viên sẽ thấy bản đã trộn."}
          </p>
          <div className="space-y-2">
            {draft.options.map((value, i) => (
              <div key={i} className="flex items-center gap-2">
                {type === "SINGLE_CHOICE" ? (
                  <button type="button" onClick={() => onChange({ correctIndex: i })}
                    title="Đánh dấu là đáp án đúng"
                    className={cn("shrink-0 transition-colors",
                      draft.correctIndex === i ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                    {draft.correctIndex === i
                      ? <CircleDot className="h-5 w-5" />
                      : <span className="block h-5 w-5 rounded-full border-2" />}
                  </button>
                ) : (
                  <span className="w-5 shrink-0 text-center font-mono text-xs text-muted-foreground tabular-nums">
                    {i + 1}
                  </span>
                )}
                <Input name={at("option")} value={value} onChange={(e) => setOption(i, e.target.value)}
                  aria-invalid={isInvalid("options")}
                  placeholder={type === "SINGLE_CHOICE" ? `Lựa chọn ${i + 1}` : `Từ ${i + 1}`} />
                <Button type="button" variant="ghost" size="icon" title="Bỏ dòng này"
                  onClick={() => removeOption(i)} disabled={draft.options.length <= 2}
                  className="shrink-0 hover:text-destructive hover:bg-destructive/10">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange({ options: [...draft.options, ""] })}>
            <Plus className="h-4 w-4 mr-1.5" />
            {type === "SINGLE_CHOICE" ? "Thêm lựa chọn" : "Thêm từ"}
          </Button>
        </div>
      )}

      {type === "FILL" && (
        <div className="space-y-2">
          <Label htmlFor={at("answer")}>Đáp án đúng <span className="text-destructive">*</span></Label>
          <Input id={at("answer")} name={at("answer")} value={draft.answer}
            onChange={(e) => onChange({ answer: e.target.value })}
            placeholder="我是学生" aria-invalid={isInvalid("answer")} />
          <p className="text-xs text-muted-foreground">
            Khi so đáp án, dấu câu và khoảng trắng được bỏ qua.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor={at("hint")}>
          Giải thích <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span>
        </Label>
        <Textarea id={at("hint")} name={at("hint")} value={draft.hint} rows={2}
          onChange={(e) => onChange({ hint: e.target.value })}
          placeholder="Hiện ra khi học viên bấm Xem đáp án" />
      </div>
    </div>
  );
}

function QuestionModal({
  mode, question, onClose,
}: {
  mode: ModalMode;
  question: QuestionRow | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string; field?: string; success?: boolean }>();
  const isLoading = fetcher.state !== "idle";

  const [type, setType] = useState<GrammarQuestionType>(question?.type ?? "SINGLE_CHOICE");
  // Sửa thì luôn đúng một câu; thêm mới thì admin soạn được nhiều câu cùng dạng
  const [drafts, setDrafts] = useState<Draft[]>(() => (question ? [draftFrom(question)] : [emptyDraft()]));

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.success) onClose();
  }, [fetcher.state, fetcher.data, onClose]);

  if (!mode) return null;

  if (mode === "delete") {
    if (!question) return null;
    return (
      <Overlay onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-bold">Xóa câu hỏi</h2>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <p>Xóa câu hỏi <strong>{question.prompt}</strong>?</p>
          </div>
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="question-delete" />
            <input type="hidden" name="questionId" value={question.id} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
              <Button type="submit" variant="destructive" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Xóa câu hỏi
              </Button>
            </div>
          </fetcher.Form>
        </div>
      </Overlay>
    );
  }

  const isEdit = mode === "edit";
  const meta = GRAMMAR_QUESTION_META[type];

  const patchDraft = (index: number, patch: Partial<Draft>) =>
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));

  return (
    <Overlay onClose={onClose} className="max-w-2xl">
      <fetcher.Form method="post" className="space-y-4">
        <input type="hidden" name="intent" value={isEdit ? "question-edit" : "question-create"} />
        {isEdit && question && <input type="hidden" name="questionId" value={question.id} />}
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="count" value={String(drafts.length)} />

        <div className="flex items-start justify-between">
          <h2 className="text-lg font-bold">{isEdit ? "Sửa câu hỏi" : "Thêm câu hỏi"}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {fetcher.data?.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {fetcher.data.error}
          </div>
        )}

        <div className="space-y-2">
          <Label>Dạng câu hỏi</Label>
          <div className="grid gap-2 sm:grid-cols-3">
            {GRAMMAR_QUESTION_TYPES.map((t) => (
              <button key={t} type="button" onClick={() => setType(t)}
                className={cn("rounded-lg border p-3 text-left transition-colors",
                  type === t ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                <div className="flex items-center gap-1.5">
                  {type === t && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span className="text-sm font-medium">{GRAMMAR_QUESTION_META[t].label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{GRAMMAR_QUESTION_META[t].description}</p>
              </button>
            ))}
          </div>
          {!isEdit && drafts.length > 1 && (
            <p className="text-xs text-muted-foreground">
              Dạng này áp cho cả {drafts.length} câu bên dưới.
            </p>
          )}
        </div>

        <div className="space-y-3">
          {drafts.map((draft, i) => (
            <DraftFields key={i} index={i} draft={draft} type={type}
              invalidField={fetcher.data?.field}
              onChange={(patch) => patchDraft(i, patch)}
              showTitle={!isEdit && drafts.length > 1}
              onRemove={drafts.length > 1 ? () => setDrafts((prev) => prev.filter((_, j) => j !== i)) : undefined} />
          ))}
        </div>

        {!isEdit && (
          <Button type="button" variant="outline" className="w-full"
            onClick={() => setDrafts((prev) => [...prev, emptyDraft()])}
            disabled={drafts.length >= MAX_QUESTIONS_PER_SUBMIT}>
            <Plus className="h-4 w-4 mr-1.5" />Thêm câu nữa cùng dạng
          </Button>
        )}

        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          Học viên sẽ thấy: <span className="font-medium text-foreground">{meta.studentHint}</span>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={isLoading}>Hủy</Button>
          <Button type="submit" disabled={isLoading}>
            {isLoading && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Lưu thay đổi" : drafts.length > 1 ? `Thêm ${drafts.length} câu hỏi` : "Thêm câu hỏi"}
          </Button>
        </div>
      </fetcher.Form>
    </Overlay>
  );
}

// ─── Trang ───────────────────────────────────────────────────────────────────

export default function AdminGrammarQuestions() {
  const { user, section } = useLoaderData<typeof loader>();
  const moveFetcher = useFetcher();
  const [mode, setMode] = useState<ModalMode>(null);
  const [selected, setSelected] = useState<QuestionRow | null>(null);

  const open = (next: ModalMode, q: QuestionRow | null = null) => { setSelected(q); setMode(next); };
  const close = useCallback(() => { setMode(null); setSelected(null); }, []);

  const move = (questionId: string, direction: "up" | "down") =>
    moveFetcher.submit({ intent: "question-move", questionId, direction }, { method: "post" });

  const questions = section.questions as QuestionRow[];

  return (
    <>
      <AppShell user={user}>
        <div className="space-y-6 max-w-4xl">
          <div>
            <Button asChild variant="ghost" size="sm" className="mb-2">
              <Link to={`/admin/lessons/${section.lesson.id}/grammar`}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại danh sách ngữ pháp
              </Link>
            </Button>
            <h1 className="text-2xl font-bold tracking-tight">Luyện tập: {section.title}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              Bài {section.lesson.order} - {section.lesson.title}
            </p>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">
                    Câu hỏi <span className="text-sm font-normal text-muted-foreground">({questions.length})</span>
                  </CardTitle>
                  <CardDescription>Học viên làm lần lượt theo thứ tự bên dưới.</CardDescription>
                </div>
                <Button size="sm" onClick={() => open("create")}>
                  <Plus className="h-4 w-4 mr-1.5" />Thêm câu hỏi
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {questions.length === 0 ? (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <ListChecks className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium">Chưa có câu hỏi nào</p>
                  <p className="text-sm text-muted-foreground mt-1 mb-4">
                    Không bắt buộc — phần ngữ pháp không có câu hỏi thì học viên chỉ đọc nội dung.
                  </p>
                  <Button size="sm" onClick={() => open("create")}>
                    <Plus className="h-4 w-4 mr-1.5" />Thêm câu hỏi
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  {questions.map((q, i) => (
                    <div key={q.id} className="flex items-start gap-3 rounded-lg border p-3">
                      <div className="flex flex-col pt-0.5">
                        <button onClick={() => move(q.id, "up")} disabled={i === 0}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => move(q.id, "down")} disabled={i === questions.length - 1}
                          className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground tabular-nums w-5 text-center pt-1">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{q.prompt}</p>
                          <Badge variant="outline" className="bg-muted/50 text-muted-foreground text-[10px]">
                            {GRAMMAR_QUESTION_META[q.type].label}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Đáp án: <span className="text-foreground">{grammarAnswerText(q)}</span>
                        </p>
                        {q.type === "SINGLE_CHOICE" && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {q.options.length} lựa chọn: {q.options.join(" / ")}
                          </p>
                        )}
                        {q.type === "ARRANGE" && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {q.options.length} từ: {q.options.join(" · ")}
                          </p>
                        )}
                        {q.hint && <p className="text-xs text-muted-foreground italic mt-0.5">{q.hint}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="icon" title="Sửa" onClick={() => open("edit", q)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" title="Xóa" onClick={() => open("delete", q)}
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
        </div>
      </AppShell>
      {/* `key` ép remount → state form và fetcher reset theo câu hỏi đang mở */}
      <QuestionModal
        key={mode ? `${mode}-${selected?.id ?? "new"}` : "closed"}
        mode={mode}
        question={selected}
        onClose={close}
      />
    </>
  );
}
