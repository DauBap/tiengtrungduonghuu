import { useState } from "react";
import { useNavigation, Form, Link } from "react-router";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { BLOCK_META, type LearningBlockType, type FlashcardConfig } from "~/lib/learning-blocks";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";
import { speakChinese } from "~/lib/speech";
import { cn } from "~/lib/utils";
import { Volume2, Save, Loader2, ChevronUp, ChevronDown, Check } from "lucide-react";

export interface VocabOption {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordType: WordType | null;
  audioUrl: string | null;
}

interface FlashcardFormProps {
  vocabOptions: VocabOption[];
  /** Giá trị ban đầu khi sửa; undefined = tạo mới */
  initial?: {
    title: string;
    description: string | null;
    required: boolean;
    config: FlashcardConfig;
  };
  error?: string;
  field?: string;
  cancelTo: string;
}

/** Form cấu hình block Flashcard — dùng cho cả tạo mới và chỉnh sửa */
export function FlashcardForm({ vocabOptions, initial, error, field, cancelTo }: FlashcardFormProps) {
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const meta = BLOCK_META.FLASHCARD;

  // Thứ tự thẻ = thứ tự trong mảng này
  const [selectedIds, setSelectedIds] = useState<string[]>(initial?.config.vocabItemIds ?? []);
  const [frontSide, setFrontSide] = useState<"chinese" | "translation">(initial?.config.frontSide ?? "chinese");
  const [showPinyinOnFront, setShowPinyinOnFront] = useState(initial?.config.showPinyinOnFront ?? false);
  const [shuffle, setShuffle] = useState(initial?.config.shuffle ?? false);
  const [autoSpeak, setAutoSpeak] = useState(initial?.config.autoSpeak ?? false);

  const vocabById = new Map(vocabOptions.map((v) => [v.id, v]));
  const selected = selectedIds.map((id) => vocabById.get(id)).filter((v): v is VocabOption => Boolean(v));
  const unselected = vocabOptions.filter((v) => !selectedIds.includes(v.id));

  const toggle = (id: string) =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const moveCard = (index: number, direction: -1 | 1) => {
    const next = index + direction;
    if (next < 0 || next >= selectedIds.length) return;
    setSelectedIds((prev) => {
      const copy = [...prev];
      [copy[index], copy[next]] = [copy[next], copy[index]];
      return copy;
    });
  };

  return (
    <Form method="post" noValidate className="space-y-6">
      <input type="hidden" name="type" value="FLASHCARD" />
      <input type="hidden" name="vocabItemIds" value={selectedIds.join(",")} />
      <input type="hidden" name="frontSide" value={frontSide} />
      <input type="hidden" name="showPinyinOnFront" value={String(showPinyinOnFront)} />
      <input type="hidden" name="shuffle" value={String(shuffle)} />
      <input type="hidden" name="autoSpeak" value={String(autoSpeak)} />

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
              placeholder="Lật thẻ để ôn lại từ vựng bài này" />
          </div>
          <ToggleRow name="required" label="Bắt buộc hoàn thành"
            description="Học viên phải xong phần này mới mở được bài tập."
            checked={initial?.required ?? true} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Chọn từ vựng <span className="text-sm font-normal text-muted-foreground">({selectedIds.length} thẻ)</span>
          </CardTitle>
          <CardDescription>Bấm để chọn, dùng mũi tên để sắp thứ tự thẻ.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {selected.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Thứ tự thẻ</p>
              {selected.map((v, i) => (
                <div key={v.id} className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-2.5">
                  <span className="font-mono text-xs text-muted-foreground tabular-nums w-5 text-center">{i + 1}</span>
                  <div className="flex flex-col">
                    <button type="button" onClick={() => moveCard(i, -1)} disabled={i === 0}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Lên trên">
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button type="button" onClick={() => moveCard(i, 1)} disabled={i === selected.length - 1}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-30" title="Xuống dưới">
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-lg font-medium">{v.chinese}</span>
                      <span className="text-sm text-primary font-mono">{v.pinyin}</span>
                      {v.wordType && (
                        <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                          {WORD_TYPE_META[v.wordType].label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{v.translation}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" title="Nghe thử"
                    onClick={() => speakChinese(v.chinese, v.audioUrl)}>
                    <Volume2 className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => toggle(v.id)}>Bỏ</Button>
                </div>
              ))}
            </div>
          )}

          {unselected.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                {selected.length > 0 ? "Từ chưa chọn" : "Từ vựng trong bài"}
              </p>
              {unselected.map((v) => (
                <button key={v.id} type="button" onClick={() => toggle(v.id)}
                  className="flex w-full items-center gap-3 rounded-lg border p-2.5 text-left hover:bg-muted/50 transition-colors">
                  <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded border" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-lg font-medium">{v.chinese}</span>
                      <span className="text-sm text-primary font-mono">{v.pinyin}</span>
                      {v.wordType && (
                        <Badge variant="outline" className="text-[10px] font-normal px-1.5 py-0">
                          {WORD_TYPE_META[v.wordType].label}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{v.translation}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {unselected.length === 0 && selected.length === vocabOptions.length && (
            <p className="text-sm text-muted-foreground text-center py-2">Đã chọn hết từ vựng của bài.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tùy chọn thẻ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Mặt trước của thẻ</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: "chinese" as const, label: "Chữ Hán", hint: "Xem chữ, đoán nghĩa" },
                { value: "translation" as const, label: "Nghĩa tiếng Việt", hint: "Xem nghĩa, đoán chữ" },
              ]).map((opt) => (
                <button key={opt.value} type="button" onClick={() => setFrontSide(opt.value)}
                  className={cn("rounded-lg border p-3 text-left transition-colors",
                    frontSide === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                  <div className="flex items-center gap-2">
                    {frontSide === opt.value && <Check className="h-3.5 w-3.5 text-primary" />}
                    <span className="text-sm font-medium">{opt.label}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <ToggleRow name="showPinyinOnFront" label="Hiện pinyin ở mặt trước"
              description="Gợi ý cách đọc ngay khi chưa lật thẻ."
              checked={showPinyinOnFront} onChange={setShowPinyinOnFront} controlled
              disabled={frontSide !== "chinese"} />
            <ToggleRow name="shuffle" label="Trộn thứ tự thẻ"
              description="Mỗi lượt học thẻ xuất hiện theo thứ tự khác nhau."
              checked={shuffle} onChange={setShuffle} controlled />
            <ToggleRow name="autoSpeak" label="Tự động đọc khi chuyển thẻ"
              description="Phát âm khi học viên chuyển sang thẻ khác. Thẻ đầu tiên không tự đọc — bấm vào thẻ hoặc nút loa mới phát."
              checked={autoSpeak} onChange={setAutoSpeak} controlled />
          </div>
        </CardContent>
      </Card>

      {/* Xem trước */}
      {selected.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Xem trước mặt trước thẻ đầu tiên</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border-2 border-primary/20 bg-primary/5">
              <p className={cn("font-semibold text-center", frontSide === "chinese" ? "text-4xl" : "text-xl")}>
                {frontSide === "chinese" ? selected[0].chinese : selected[0].translation}
              </p>
              {frontSide === "chinese" && showPinyinOnFront && (
                <p className="text-base text-primary font-mono">{selected[0].pinyin}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

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
 * Hàng bật/tắt. Khi `controlled` thì state do component cha giữ (để dùng cho xem trước),
 * giá trị gửi lên server qua input hidden riêng ở FlashcardForm.
 */
function ToggleRow({
  name, label, description, checked, onChange, controlled = false, disabled = false,
}: {
  name: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange?: (value: boolean) => void;
  controlled?: boolean;
  disabled?: boolean;
}) {
  const [internal, setInternal] = useState(checked);
  const value = controlled ? checked : internal;

  const set = (next: boolean) => {
    if (controlled) onChange?.(next);
    else setInternal(next);
  };

  return (
    <label className={cn("flex items-start gap-3 cursor-pointer", disabled && "opacity-50 cursor-not-allowed")}>
      {/* Chỉ input không controlled mới submit trực tiếp; controlled dùng hidden field ở form */}
      {!controlled && <input type="hidden" name={name} value={String(value)} />}
      <button type="button" role="switch" aria-checked={value} disabled={disabled}
        onClick={() => !disabled && set(!value)}
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
