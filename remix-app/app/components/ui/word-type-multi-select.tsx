import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { WORD_TYPE_META, WORD_TYPES, isWordType, type WordType } from "~/lib/word-types";

interface WordTypeMultiSelectProps {
  name: string;
  value: unknown;
}

export function WordTypeMultiSelect({ name, value }: WordTypeMultiSelectProps) {
  const [selectedTypes, setSelectedTypes] = useState<WordType[]>(
    Array.isArray(value) ? value.filter(isWordType) : [],
  );

  const toggleType = (type: WordType) => {
    setSelectedTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  return (
    <details className="group">
      <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 rounded-md border border-input bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className={selectedTypes.length ? "text-foreground" : "text-muted-foreground"}>
          {selectedTypes.length
            ? selectedTypes.map((type) => WORD_TYPE_META[type].label).join(", ")
            : "Chọn một hoặc nhiều từ loại"}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <fieldset className="mt-2 grid gap-1 rounded-md border bg-background p-2 sm:grid-cols-2">
        <legend className="sr-only">Chọn từ loại</legend>
        {WORD_TYPES.map((type) => (
          <label key={type} className="flex min-h-9 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-muted/50">
            <input
              type="checkbox"
              checked={selectedTypes.includes(type)}
              onChange={() => toggleType(type)}
              className="h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span>{WORD_TYPE_META[type].label} <span className="text-muted-foreground">({WORD_TYPE_META[type].chinese})</span></span>
          </label>
        ))}
        {selectedTypes.map((type) => <input key={type} type="hidden" name={name} value={type} />)}
      </fieldset>
    </details>
  );
}
