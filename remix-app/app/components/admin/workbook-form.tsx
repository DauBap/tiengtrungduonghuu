import { useState } from "react";
import { useNavigation, Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Switch } from "~/components/ui/switch";
import { BLOCK_META, type WorkbookConfig } from "~/lib/learning-blocks";
import { cn } from "~/lib/utils";
import {
  Save, Loader2, Plus, Trash2, ChevronUp, ChevronDown,
  GripVertical, BookMarked, Settings,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Option = { id: string; label: "A" | "B" | "C" | "D" | "E" | "F"; text: string; pinyin: string };
type Question = WorkbookConfig["sections"][number]["questions"][number];
type Section = WorkbookConfig["sections"][number];

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"] as const;

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function emptySection(number: number): Section {
  return {
    id: uid(),
    title: `Phần ${number}`,
    titleChinese: "",
    description: "",
    descriptionVietnamese: "",
    example: undefined,
    questions: [],
  };
}

function emptyQuestion(number: number): Question {
  return {
    id: uid(),
    number,
    kind: "choice",
    prompt: "",
    pinyin: "",
    translation: "",
    passage: "",
    gradable: true,
    imageUrl: "",
    images: undefined,
    dialogue: undefined,
    options: [
      { id: uid(), label: "A", text: "", pinyin: "" },
      { id: uid(), label: "B", text: "", pinyin: "" },
      { id: uid(), label: "C", text: "", pinyin: "" },
    ],
    correctAnswer: "",
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WorkbookFormProps {
  initial?: {
    title: string;
    description: string | null;
    required: boolean;
    config: WorkbookConfig;
  };
  error?: string;
  cancelTo: string;
}

// ─── Question Editor ─────────────────────────────────────────────────────────

function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  question: Question;
  index: number;
  total: number;
  onChange: (q: Question) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const updateOption = (optId: string, field: "text" | "pinyin", value: string) =>
    onChange({
      ...question,
      options: question.options.map((o) => (o.id === optId ? { ...o, [field]: value } : o)),
    });

  const addOption = () => {
    if (question.options.length >= 6) return;
    const nextLabel = OPTION_LABELS[question.options.length];
    onChange({
      ...question,
      options: [...question.options, { id: uid(), label: nextLabel, text: "", pinyin: "" }],
    });
  };

  const removeOption = (optId: string) => {
    if (question.options.length <= 2) return;
    onChange({
      ...question,
      options: question.options.filter((o) => o.id !== optId),
      correctAnswer: question.correctAnswer === optId ? "" : question.correctAnswer,
    });
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
            className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <Badge variant="outline" className="text-xs">Câu {question.number}</Badge>
        <div className="flex-1" />
        <button type="button" onClick={onDelete}
          className="text-muted-foreground hover:text-destructive transition-colors">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="flex gap-2" role="group" aria-label="Loại câu hỏi">
        <Button type="button" size="sm" variant={question.kind === "choice" ? "default" : "outline"}
          onClick={() => onChange({
            ...question,
            kind: "choice",
            options: question.options.length ? question.options : OPTION_LABELS.slice(0, 3).map((label) => ({ id: uid(), label, text: "", pinyin: "" })),
            gradable: question.kind === "choice" ? question.gradable : false,
            correctAnswer: question.kind === "choice" ? question.correctAnswer : "",
          })}>
          Trắc nghiệm
        </Button>
        <Button type="button" size="sm" variant={question.kind === "input" ? "default" : "outline"}
          onClick={() => onChange({ ...question, kind: "input", gradable: false, options: [], correctAnswer: "" })}>
          Điền chữ
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Input value={question.prompt} onChange={(e) => onChange({ ...question, prompt: e.target.value })}
          placeholder="Câu hỏi / câu cần điền" className="h-8 text-sm" />
        <Input value={question.pinyin} onChange={(e) => onChange({ ...question, pinyin: e.target.value })}
          placeholder="Pinyin" className="h-8 text-sm" />
        <Input value={question.translation} onChange={(e) => onChange({ ...question, translation: e.target.value })}
          placeholder="Bản dịch (tùy chọn)" className="h-8 text-sm sm:col-span-2" />
        <Input value={question.passage} onChange={(e) => onChange({ ...question, passage: e.target.value })}
          placeholder="Đoạn văn / ngữ cảnh (tùy chọn)" className="h-8 text-sm sm:col-span-2" />
      </div>

      {/* URL ảnh đơn */}
      <div className="space-y-1">
        <Label className="text-xs">URL ảnh <span className="text-muted-foreground font-normal">(tùy chọn)</span></Label>
        <Input
          placeholder="https://..."
          value={question.imageUrl ?? ""}
          onChange={(e) => onChange({ ...question, imageUrl: e.target.value })}
          className="h-8 text-sm"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Upload ảnh câu hỏi <span className="text-muted-foreground font-normal">(tùy chọn)</span></Label>
        <Input
          name={`questionImageFile-${question.id}`}
          type="file"
          accept="image/*"
          className="h-8 text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1"
        />
      </div>

      {question.kind === "input" ? (
        <div className="space-y-1.5">
          <Label className="text-xs">Đáp án đúng</Label>
          <Input value={question.correctAnswer}
            onChange={(e) => onChange({ ...question, correctAnswer: e.target.value, gradable: Boolean(e.target.value.trim()) })}
            placeholder="Nhập đáp án chính xác" className="h-8 text-sm" />
        </div>
      ) : <div className="space-y-1.5">
        <Label className="text-xs">Đáp án</Label>
        {question.options.map((opt) => (
          <div key={opt.id} className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange({ ...question, gradable: true, correctAnswer: opt.id })}
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                question.correctAnswer === opt.id
                  ? "border-success bg-success text-success-foreground"
                  : "border-muted-foreground/40 hover:border-primary"
              )}
              title="Đánh dấu là đáp án đúng"
            >
              {opt.label}
            </button>
            <div className="min-w-0 flex-1 space-y-1">
              <Input
                value={opt.text}
                onChange={(e) => updateOption(opt.id, "text", e.target.value)}
                placeholder={`Đáp án ${opt.label}`}
                className="h-8 text-sm"
              />
              <Input
                value={opt.pinyin}
                onChange={(e) => updateOption(opt.id, "pinyin", e.target.value)}
                placeholder={`Pinyin ${opt.label} (tùy chọn)`}
                className="h-8 text-sm"
              />
            </div>
            {question.options.length > 2 && (
              <button type="button" onClick={() => removeOption(opt.id)}
                className="text-muted-foreground hover:text-destructive shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {question.options.length < 6 && (
          <Button type="button" variant="ghost" size="sm" onClick={addOption}>
            <Plus className="h-3.5 w-3.5 mr-1" />Thêm đáp án
          </Button>
        )}
        {!question.correctAnswer && (
          <p className="text-xs text-warning">Bấm vào nút chữ cái để chọn đáp án đúng.</p>
        )}
      </div>}
    </div>
  );
}

// ─── Section Editor ───────────────────────────────────────────────────────────

function SectionEditor({
  section,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  section: Section;
  index: number;
  total: number;
  onChange: (s: Section) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [expanded, setExpanded] = useState(true);

  const addQuestion = () => {
    const nextNumber = (section.questions[section.questions.length - 1]?.number ?? 0) + 1;
    onChange({ ...section, questions: [...section.questions, emptyQuestion(nextNumber)] });
  };

  const updateQuestion = (i: number, q: Question) =>
    onChange({ ...section, questions: section.questions.map((old, idx) => (idx === i ? q : old)) });

  const deleteQuestion = (i: number) =>
    onChange({ ...section, questions: section.questions.filter((_, idx) => idx !== i) });

  const moveQuestion = (i: number, dir: -1 | 1) => {
    const qs = [...section.questions];
    [qs[i], qs[i + dir]] = [qs[i + dir], qs[i]];
    onChange({ ...section, questions: qs });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="flex flex-col">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => onMove(1)} disabled={index === total - 1}
              className="text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </div>
          <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0" />
          <CardTitle className="text-sm flex-1">{section.title || `Phần ${index + 1}`}</CardTitle>
          <Badge variant="outline" className="text-xs shrink-0">{section.questions.length} câu</Badge>
          <button type="button" onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground text-xs">
            {expanded ? "Thu gọn" : "Mở rộng"}
          </button>
          <button type="button" onClick={onDelete}
            className="text-muted-foreground hover:text-destructive transition-colors ml-1">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-4">
          {/* Thông tin phần */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Tên phần (tiếng Việt) <span className="text-destructive">*</span></Label>
              <Input
                value={section.title}
                onChange={(e) => onChange({ ...section, title: e.target.value })}
                placeholder="VD: Phần 1"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tên phần (tiếng Trung)</Label>
              <Input
                value={section.titleChinese}
                onChange={(e) => onChange({ ...section, titleChinese: e.target.value })}
                placeholder="VD: 第一部分"
                className="h-8 text-sm font-medium"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hướng dẫn (tiếng Trung)</Label>
              <Input
                value={section.description}
                onChange={(e) => onChange({ ...section, description: e.target.value })}
                placeholder="VD: 第1—5题：选择正确答案。"
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Hướng dẫn (tiếng Việt)</Label>
              <Input
                value={section.descriptionVietnamese}
                onChange={(e) => onChange({ ...section, descriptionVietnamese: e.target.value })}
                placeholder="VD: Câu 1-5: Chọn đáp án đúng."
                className="h-8 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Ảnh dùng chung cho phần (URL)</Label>
              <Input
                value={section.imageUrl ?? ""}
                onChange={(e) => onChange({ ...section, imageUrl: e.target.value })}
                placeholder="https://... hoặc /images/..."
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Upload ảnh dùng chung</Label>
              <Input
                name={`sectionImageFile-${section.id}`}
                type="file"
                accept="image/*"
                className="h-8 text-sm file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1"
              />
            </div>
          </div>

          {/* Câu hỏi */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground">Câu hỏi ({section.questions.length})</p>
            {section.questions.map((q, i) => (
              <QuestionEditor
                key={q.id}
                question={q}
                index={i}
                total={section.questions.length}
                onChange={(updated) => updateQuestion(i, updated)}
                onDelete={() => deleteQuestion(i)}
                onMove={(dir) => moveQuestion(i, dir)}
              />
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addQuestion}>
              <Plus className="h-4 w-4 mr-1.5" />Thêm câu hỏi
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ─── WorkbookForm ─────────────────────────────────────────────────────────────

export function WorkbookForm({ initial, error, cancelTo }: WorkbookFormProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const meta = BLOCK_META.WORKBOOK;

  const [title, setTitle] = useState(initial?.title ?? meta.defaultTitle);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [audioUrl, setAudioUrl] = useState(initial?.config.audioUrl ?? "");
  const [timeLimit, setTimeLimit] = useState(initial?.config.timeLimit ?? 0);
  const [maxReplays, setMaxReplays] = useState(initial?.config.maxReplays ?? 0);
  const [shuffleQuestions, setShuffleQuestions] = useState(initial?.config.shuffleQuestions ?? false);
  const [showResultsImmediately, setShowResultsImmediately] = useState(initial?.config.showResultsImmediately ?? false);
  const [showTranslation, setShowTranslation] = useState(initial?.config.showTranslation ?? true);
  const [showPinyin, setShowPinyin] = useState(initial?.config.showPinyin ?? true);
  const [sections, setSections] = useState<Section[]>(initial?.config.sections ?? []);

  const addSection = () =>
    setSections((prev) => [...prev, emptySection(prev.length + 1)]);

  const updateSection = (i: number, s: Section) =>
    setSections((prev) => prev.map((old, idx) => (idx === i ? s : old)));

  const deleteSection = (i: number) =>
    setSections((prev) => prev.filter((_, idx) => idx !== i));

  const moveSection = (i: number, dir: -1 | 1) => {
    const copy = [...sections];
    [copy[i], copy[i + dir]] = [copy[i + dir], copy[i]];
    setSections(copy);
  };

  const config: WorkbookConfig = {
    audioUrl: audioUrl || undefined,
    timeLimit,
    maxReplays,
    shuffleQuestions,
    showResultsImmediately,
    showTranslation,
    showPinyin,
    sections,
  };

  return (
    <Form method="post" encType="multipart/form-data" noValidate className="space-y-6">
      <input type="hidden" name="type" value="WORKBOOK" />
      <input type="hidden" name="title" value={title} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="required" value="true" />
      <input type="hidden" name="workbookConfig" value={JSON.stringify(config)} />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Thông tin chung */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookMarked className="h-4 w-4" />Thông tin chung
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wb-title">Tiêu đề <span className="text-destructive">*</span></Label>
            <Input
              id="wb-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sách bài tập"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wb-desc">Mô tả <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
            <Input
              id="wb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Bài thi nghe mô phỏng HSK"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wb-audio">URL file audio <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
            <Input
              id="wb-audio"
              value={audioUrl}
              onChange={(e) => setAudioUrl(e.target.value)}
              placeholder="https://..."
            />
            <p className="text-xs text-muted-foreground">File audio phát khi học viên mở tab Sách bài tập.</p>
          </div>
        </CardContent>
      </Card>

      {/* Cài đặt */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="h-4 w-4" />Cài đặt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wb-time">Giới hạn thời gian (phút)</Label>
              <Input
                id="wb-time"
                type="number"
                min="0"
                value={timeLimit}
                onChange={(e) => setTimeLimit(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">0 = không giới hạn</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="wb-replays">Số lần phát lại audio</Label>
              <Input
                id="wb-replays"
                type="number"
                min="0"
                value={maxReplays}
                onChange={(e) => setMaxReplays(parseInt(e.target.value) || 0)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">0 = không giới hạn</p>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="wb-shuffle">Xáo trộn câu hỏi</Label>
                <p className="text-xs text-muted-foreground">Thứ tự câu hỏi sẽ khác nhau mỗi lần làm bài</p>
              </div>
              <Switch
                id="wb-shuffle"
                checked={shuffleQuestions}
                onCheckedChange={setShuffleQuestions}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="wb-instant">Hiển thị kết quả ngay</Label>
                <p className="text-xs text-muted-foreground">Học viên thấy đúng/sai ngay sau khi chọn đáp án</p>
              </div>
              <Switch
                id="wb-instant"
                checked={showResultsImmediately}
                onCheckedChange={setShowResultsImmediately}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="wb-translation">Hiển thị phần dịch</Label>
                <p className="text-xs text-muted-foreground">Hiện bản dịch tiếng Việt trong câu hỏi</p>
              </div>
              <Switch
                id="wb-translation"
                checked={showTranslation}
                onCheckedChange={setShowTranslation}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="wb-pinyin">Hiển thị pinyin</Label>
                <p className="text-xs text-muted-foreground">Hiện phiên âm pinyin trong câu hỏi</p>
              </div>
              <Switch
                id="wb-pinyin"
                checked={showPinyin}
                onCheckedChange={setShowPinyin}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Các phần bài tập */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Các phần bài tập <span className="text-sm font-normal text-muted-foreground">({sections.length})</span></h2>
          <Button type="button" variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-4 w-4 mr-1.5" />Thêm phần
          </Button>
        </div>

        {sections.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <BookMarked className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-medium">Chưa có phần nào</p>
            <p className="text-sm text-muted-foreground mt-1 mb-4">
              Mỗi phần gồm hướng dẫn, câu ví dụ và danh sách câu hỏi.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={addSection}>
              <Plus className="h-4 w-4 mr-1.5" />Thêm phần đầu tiên
            </Button>
          </div>
        ) : (
          sections.map((s, i) => (
            <SectionEditor
              key={s.id}
              section={s}
              index={i}
              total={sections.length}
              onChange={(updated) => updateSection(i, updated)}
              onDelete={() => deleteSection(i)}
              onMove={(dir) => moveSection(i, dir)}
            />
          ))
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" asChild><Link to={cancelTo}>Hủy</Link></Button>
        <Button type="submit" disabled={isSubmitting || !title.trim()}>
          {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          {isSubmitting ? "Đang lưu..." : "Lưu"}
        </Button>
      </div>
    </Form>
  );
}
