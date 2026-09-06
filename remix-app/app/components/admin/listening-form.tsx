import { useState } from "react";
import { useNavigation, Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { BLOCK_META, type ListeningConfig } from "~/lib/learning-blocks";
import { speakChinese } from "~/lib/speech";
import { cn } from "~/lib/utils";
import { Volume2, Save, Loader2, ChevronUp, ChevronDown, Check } from "lucide-react";

/** Một mục có thể dùng làm câu hỏi nghe — từ vựng hoặc câu mẫu */
export interface ListeningOption {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  audioUrl: string | null;
}

interface ListeningFormProps {
  vocabOptions: ListeningOption[];
  sentenceOptions: ListeningOption[];
  /** Giá trị ban đầu khi sửa; undefined = tạo mới */
  initial?: {
    title: string;
    description: string | null;
    required: boolean;
    config: ListeningConfig;
  };
  error?: string;
  field?: string;
  cancelTo: string;
}

/** Form cấu hình block Nghe câu — dùng cho cả tạo mới và chỉnh sửa */
export function ListeningForm({ vocabOptions, sentenceOptions, initial, error, field, cancelTo }: ListeningFormProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const meta = BLOCK_META.LISTENING;

  const [source, setSource] = useState<"vocab" | "sentence">(initial?.config.source ?? "vocab");
  const [answerMode, setAnswerMode] = useState<"chinese" | "pinyin">(initial?.config.answerMode ?? "chinese");
  const [maxReplays, setMaxReplays] = useState(initial?.config.maxReplays ?? 0);
  const [shuffle, setShuffle] = useState(initial?.config.shuffle ?? false);

  // Giữ lựa chọn của cả hai nguồn để admin đổi qua đổi lại không mất công chọn
  const [vocabIds, setVocabIds] = useState<string[]>(initial?.config.vocabItemIds ?? []);
  const [sentenceIds, setSentenceIds] = useState<string[]>(initial?.config.sentenceItemIds ?? []);

  const options = source === "vocab" ? vocabOptions : sentenceOptions;
  const selectedIds = source === "vocab" ? vocabIds : sentenceIds;
  const setSelectedIds = source === "vocab" ? setVocabIds : setSentenceIds;

  const byId = new Map(options.map((o) => [o.id, o]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((o): o is ListeningOption => Boolean(o));
  const unselected = options.filter((o) => !selectedIds.includes(o.id));

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const move = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= selectedIds.length) return;
    setSelectedIds((prev) => {
      const copy = [...prev];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  };

  const sourceLabel = source === "vocab" ? "từ vựng" : "câu";

  return (
    <Form method="post" noValidate className="space-y-6">
      <input type="hidden" name="type" value="LISTENING" />
      <input type="hidden" name="source" value={source} />
      <input type="hidden" name="vocabItemIds" value={vocabIds.join(",")} />
      <input type="hidden" name="sentenceItemIds" value={sentenceIds.join(",")} />
      <input type="hidden" name="answerMode" value={answerMode} />
      <input type="hidden" name="maxReplays" value={String(maxReplays)} />
      <input type="hidden" name="shuffle" value={String(shuffle)} />

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thông tin chung</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Tiêu đề <span className="text-destructive">*</span></Label>
            <Input id="title" name="title" defaultValue={initial?.title ?? meta.defaultTitle}
              aria-invalid={field === "title" || undefined} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Mô tả <span className="text-muted-foreground font-normal text-xs">(tùy chọn)</span></Label>
            <Input id="description" name="description" defaultValue={initial?.description ?? ""}
              placeholder="Nghe và nhập lại nội dung vừa nghe" />
          </div>
          <ToggleRow name="required" label="Bắt buộc hoàn thành"
            description="Học viên phải xong phần này mới mở được bài tập."
            checked={initial?.required ?? true} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nguồn câu hỏi</CardTitle>
          <CardDescription>Lấy câu hỏi từ kho từ vựng hoặc kho câu của bài.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2">
            {([
              { value: "vocab" as const, label: "Từ vựng", count: vocabOptions.length },
              { value: "sentence" as const, label: "Câu mẫu", count: sentenceOptions.length },
            ]).map((opt) => (
              <button key={opt.value} type="button" onClick={() => setSource(opt.value)}
                disabled={opt.count === 0}
                className={cn("rounded-lg border p-3 text-left transition-colors",
                  source === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                  opt.count === 0 && "opacity-50 cursor-not-allowed")}>
                <div className="flex items-center gap-2">
                  {source === opt.value && <Check className="h-3.5 w-3.5 text-primary" />}
                  <span className="text-sm font-medium">{opt.label}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {opt.count === 0 ? "Chưa có nội dung" : `${opt.count} mục trong bài`}
                </p>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Chọn câu hỏi <span className="text-sm font-normal text-muted-foreground">({selectedIds.length} câu)</span>
          </CardTitle>
          <CardDescription>Bấm để chọn, dùng mũi tên để sắp thứ tự.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selected.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Thứ tự câu hỏi</p>
              {selected.map((o, i) => (
                <div key={o.id} className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums w-5 text-center">{i + 1}</span>
                  <div className="flex flex-col">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium truncate">{o.chinese}</p>
                    <p className="text-xs text-primary font-mono truncate">{o.pinyin}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" title="Nghe thử"
                    onClick={() => speakChinese(o.chinese, o.audioUrl)}>
                    <Volume2 className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => toggle(o.id)}>Bỏ</Button>
                </div>
              ))}
            </div>
          )}

          {unselected.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {selected.length > 0 ? `${sourceLabel === "câu" ? "Câu" : "Từ"} chưa chọn` : `${sourceLabel === "câu" ? "Câu" : "Từ vựng"} trong bài`}
              </p>
              {unselected.map((o) => (
                <button key={o.id} type="button" onClick={() => toggle(o.id)}
                  className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-muted/50 transition-colors">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border" />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-medium truncate">{o.chinese}</p>
                    <p className="text-xs text-primary font-mono truncate">{o.pinyin}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {options.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              Bài chưa có {sourceLabel} nào. Hãy thêm ở trang bài học trước.
            </p>
          )}
          {options.length > 0 && unselected.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">Đã chọn hết {sourceLabel} của bài.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tùy chọn</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Học viên nhập</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "chinese" as const, label: "Chữ Hán", hint: "Nghe rồi viết chữ" },
                { value: "pinyin" as const, label: "Pinyin", hint: "Nghe rồi ghi cách đọc" },
              ]).map((opt) => (
                <button key={opt.value} type="button" onClick={() => setAnswerMode(opt.value)}
                  className={cn("rounded-lg border p-3 text-left transition-colors",
                    answerMode === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                  <div className="flex items-center gap-2">
                    {answerMode === opt.value && <Check className="h-3.5 w-3.5 text-primary" />}
                    <span className="text-sm font-medium">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Khi so đáp án, dấu câu và khoảng trắng được bỏ qua; pinyin không cần dấu thanh.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <Label htmlFor="maxReplays">Số lần được nghe mỗi câu</Label>
            <Input id="maxReplays" type="number" min={0} max={20} value={maxReplays}
              onChange={(e) => setMaxReplays(Math.max(0, Number(e.target.value) || 0))}
              className="w-28" />
            <p className="text-xs text-muted-foreground">Để 0 nếu cho nghe lại không giới hạn.</p>
          </div>

          <div className="pt-2">
            <ToggleRow name="shuffle" label="Trộn thứ tự câu hỏi"
              description="Mỗi lượt làm câu xuất hiện theo thứ tự khác nhau."
              checked={shuffle} onChange={setShuffle} controlled />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" asChild><Link to={cancelTo}>Hủy</Link></Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Save className="h-4 w-4 mr-1.5" />}
          {isSubmitting ? "Đang lưu..." : "Lưu"}
        </Button>
      </div>
    </Form>
  );
}

/**
 * Hàng bật/tắt. Khi `controlled` thì state do component cha giữ,
 * giá trị gửi lên server qua input hidden riêng ở ListeningForm.
 */
function ToggleRow({
  name, label, description, checked, onChange, controlled = false,
}: {
  name: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  controlled?: boolean;
}) {
  const [internal, setInternal] = useState(checked);
  const value = controlled ? checked : internal;

  const set = (next: boolean) => {
    if (controlled) onChange?.(next);
    else setInternal(next);
  };

  return (
    <label className="flex items-start gap-3 cursor-pointer">
      {!controlled && <input type="hidden" name={name} value={String(value)} />}
      <button type="button" role="switch" aria-checked={value} onClick={() => set(!value)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors",
          value ? "bg-primary" : "bg-muted-foreground/30")}>
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-all",
          value ? "left-[1.125rem]" : "left-0.5")} />
      </button>
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </label>
  );
}
