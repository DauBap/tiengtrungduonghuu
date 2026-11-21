import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "~/components/ui/button";
import { isRecord } from "~/lib/content-corrections";

interface ScriptLine {
  id?: string;
  speakerName: string;
  chinese: string;
  pinyin: string;
  translation: string;
}

interface AudioScriptCorrectionEditorProps {
  name: string;
  value: unknown;
}

function getScriptLines(value: unknown): ScriptLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((line) => {
    if (!isRecord(line)) return [];
    return [{
      ...(typeof line.id === "string" ? { id: line.id } : {}),
      speakerName: typeof line.speakerName === "string" ? line.speakerName : "",
      chinese: typeof line.chinese === "string" ? line.chinese : "",
      pinyin: typeof line.pinyin === "string" ? line.pinyin : "",
      translation: typeof line.translation === "string" ? line.translation : "",
    }];
  });
}

const inputClassName = "h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function AudioScriptCorrectionEditor({ name, value }: AudioScriptCorrectionEditorProps) {
  const [lines, setLines] = useState(() => getScriptLines(value));

  function updateLine(index: number, field: keyof ScriptLine, nextValue: string) {
    setLines((current) => current.map((line, lineIndex) =>
      lineIndex === index ? { ...line, [field]: nextValue } : line,
    ));
  }

  return (
    <div className="space-y-3">
      {lines.map((line, index) => (
        <fieldset key={line.id ?? `new-${index}`} className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <legend className="px-1 text-xs font-semibold text-muted-foreground">
              Lượt thoại {index + 1}{line.speakerName ? ` · ${line.speakerName}` : ""}
            </legend>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              aria-label={`Xóa lượt thoại ${index + 1}`}
              onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <input aria-label={`Người nói lượt ${index + 1}`} className={inputClassName} value={line.speakerName} placeholder="Người nói" onChange={(event) => updateLine(index, "speakerName", event.currentTarget.value)} />
            <input aria-label={`Tiếng Trung lượt ${index + 1}`} className={inputClassName} value={line.chinese} placeholder="Tiếng Trung" onChange={(event) => updateLine(index, "chinese", event.currentTarget.value)} />
            <input aria-label={`Pinyin lượt ${index + 1}`} className={inputClassName} value={line.pinyin} placeholder="Pinyin" onChange={(event) => updateLine(index, "pinyin", event.currentTarget.value)} />
            <input aria-label={`Nghĩa tiếng Việt lượt ${index + 1}`} className={inputClassName} value={line.translation} placeholder="Nghĩa tiếng Việt" onChange={(event) => updateLine(index, "translation", event.currentTarget.value)} />
          </div>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setLines((current) => [...current, {
          speakerName: `Người ${current.length + 1}`,
          chinese: "",
          pinyin: "",
          translation: "",
        }])}
      >
        <Plus aria-hidden="true" className="h-4 w-4" />
        Thêm lượt thoại
      </Button>
      <input type="hidden" name={name} value={JSON.stringify(lines)} />
    </div>
  );
}
