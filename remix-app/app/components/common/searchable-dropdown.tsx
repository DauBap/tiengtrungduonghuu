import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Input } from "~/components/ui/input";

export interface SearchableDropdownOption {
  value: string;
  label: string;
}

export function normalizeFilterSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .trim();
}

export function SearchableDropdown({
  id,
  label,
  placeholder,
  searchPlaceholder,
  options,
  value,
  onChange,
  className,
}: {
  id: string;
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  options: SearchableDropdownOption[];
  value: string;
  onChange: (value: string) => void;
  className: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedLabel = options.find((option) => option.value === value)?.label;
  const filteredOptions = options.filter((option) =>
    normalizeFilterSearch(option.label).includes(normalizeFilterSearch(query))
  );
  const listboxId = `${id}-options`;

  useEffect(() => {
    if (isOpen) searchInputRef.current?.focus();
  }, [isOpen]);

  function closeDropdown() {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  }

  return (
    <div
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeDropdown();
      }}
    >
      <button
        id={id}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        onClick={() => {
          setIsOpen((open) => !open);
          setQuery("");
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeDropdown();
        }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className={selectedLabel ? "truncate" : "truncate text-muted-foreground"}>
          {selectedLabel ?? placeholder}
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="relative p-1">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              role="combobox"
              aria-label={searchPlaceholder.replace(/\.\.\.$/, "")}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-activedescendant={filteredOptions[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
              autoComplete="off"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  closeDropdown();
                } else if (event.key === "ArrowDown" && filteredOptions.length > 0) {
                  event.preventDefault();
                  setActiveIndex((index) => (index + 1) % filteredOptions.length);
                } else if (event.key === "ArrowUp" && filteredOptions.length > 0) {
                  event.preventDefault();
                  setActiveIndex((index) => (index - 1 + filteredOptions.length) % filteredOptions.length);
                } else if (event.key === "Enter" && filteredOptions[activeIndex]) {
                  event.preventDefault();
                  onChange(filteredOptions[activeIndex].value);
                  closeDropdown();
                }
              }}
              placeholder={searchPlaceholder}
              className="h-9 pl-8"
            />
          </div>
          <div id={listboxId} role="listbox" aria-label={label} className="max-h-56 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy lựa chọn phù hợp.</p>
            ) : filteredOptions.map((option, index) => (
              <button
                key={option.value || "all"}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => {
                  onChange(option.value);
                  closeDropdown();
                }}
                className={`flex min-h-9 w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                }`}
              >
                <span className="min-w-0 truncate">{option.label}</span>
                {option.value === value && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
