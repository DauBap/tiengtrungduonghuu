import { useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PenLine, Search, Volume2, X } from "lucide-react";
import { speakChinese } from "~/lib/speech";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";
import { LessonTabEmpty } from "./lesson-tab-empty";
import { StrokeOrderDialog, splitHanCharacters } from "./stroke-order-dialog";
import { useAppSettings } from "~/lib/app-settings";

export interface VocabularyItem {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordTypes: WordType[];
  audioUrl: string | null;
}

interface VocabularyTableProps {
  items: VocabularyItem[];
  searchable?: boolean;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d");
}

export function VocabularyTable({ items, searchable = false }: VocabularyTableProps) {
  const settings = useAppSettings();
  // Từ đang xem cách viết; null = đóng hộp thoại.
  const [strokeItem, setStrokeItem] = useState<VocabularyItem | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const filteredItems = useMemo(() => {
    const query = normalizeSearchText(searchQuery.trim());
    if (!query) return items.map((item, index) => ({ item, index }));

    return items.flatMap((item, index) => {
      const searchableText = normalizeSearchText([item.chinese, item.pinyin, item.translation, ...(item.wordTypes ?? []).map((type) => WORD_TYPE_META[type].label)].join(" "));

      return searchableText.includes(query) ? [{ item, index }] : [];
    });
  }, [items, searchQuery]);

  if (items.length === 0) return <LessonTabEmpty tab="VOCABULARY" />;

  return (
    <div className="w-full min-w-0 max-w-full space-y-3">
      {searchable && (
        <div className="space-y-2">
          <Label htmlFor="vocabulary-search">Tìm kiếm từ vựng</Label>
          <div className="relative">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="vocabulary-search" type="text" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Chữ Hán, pinyin, nghĩa tiếng Việt..." className="pl-9 pr-12" />
            {searchQuery && (
              <Button type="button" variant="ghost" size="icon" className="absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2" onClick={() => setSearchQuery("")} aria-label="Xóa nội dung tìm kiếm">
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {searchQuery.trim() ? `Tìm thấy ${filteredItems.length}/${items.length} từ` : `Tổng cộng ${items.length} từ`}
          </p>
        </div>
      )}

      {filteredItems.length === 0 ? (
        <div role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          Không tìm thấy từ phù hợp. Thử tìm bằng chữ Hán, pinyin hoặc nghĩa tiếng Việt.
        </div>
      ) : (
        <div className="w-full min-w-0 max-w-full rounded-lg border">
          <Table className="w-max table-auto">
            <TableHeader>
              <TableRow>
                <TableHead className="sticky left-0 z-30 w-10 whitespace-nowrap bg-background px-2 text-center shadow-[2px_0_4px_-2px_hsl(var(--border))] sm:w-12 sm:px-4">#</TableHead>
                <TableHead className="sticky left-10 z-20 whitespace-nowrap bg-background px-2 shadow-[2px_0_4px_-2px_hsl(var(--border))] sm:left-12 sm:px-4">Chữ Hán</TableHead>
                {settings.showPinyin && <TableHead className="whitespace-nowrap px-3 sm:px-4">Pinyin</TableHead>}
                <TableHead className="whitespace-nowrap px-3 sm:px-4">Từ loại</TableHead>
                <TableHead className="whitespace-nowrap px-3 sm:px-4">Tiếng Việt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map(({ item, index }) => (
                <TableRow key={item.id}>
                  <TableCell className="sticky left-0 z-20 w-10 bg-background px-2 py-3 text-center font-mono text-sm text-muted-foreground shadow-[2px_0_4px_-2px_hsl(var(--border))] tabular-nums sm:w-12 sm:px-4 sm:py-4">
                    {index + 1}
                  </TableCell>
                  <TableCell className="sticky left-10 z-10 bg-background px-2 py-3 font-semibold text-lg shadow-[2px_0_4px_-2px_hsl(var(--border))] sm:left-12 sm:px-4 sm:py-4">
                    <div className="flex w-max items-center gap-1.5 whitespace-nowrap">
                      {/* Chữ Hán ngắt dòng được ở mọi ký tự nên phải chặn tay */}
                      <span className="content-text hanzi-display !text-[20px] whitespace-nowrap">{item.chinese}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 shrink-0 p-0 text-primary hover:bg-primary/10 hover:text-primary"
                        onClick={() => speakChinese(item.chinese, item.audioUrl)}
                        title="Nghe phát âm"
                      >
                        <Volume2 className="h-4 w-4" />
                      </Button>
                      {/* Từ không có chữ Hán (chỉ Latin/số) thì không có nét để tô */}
                      {splitHanCharacters(item.chinese).length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 shrink-0 p-0 text-primary hover:bg-primary/10 hover:text-primary"
                          onClick={() => setStrokeItem(item)}
                          title="Xem cách viết"
                        >
                          <PenLine className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  {settings.showPinyin && <TableCell className="content-text pinyin-text !text-[16px] whitespace-nowrap px-3 py-3 text-primary sm:px-4 sm:py-4">{item.pinyin}</TableCell>}
                  <TableCell className="whitespace-nowrap px-3 py-3 sm:px-4 sm:py-4">
                    {item.wordTypes?.length ? (
                      <div className="flex w-max gap-1">
                        {item.wordTypes.map((type) => (
                          <Badge key={type} variant="outline" className="text-xs whitespace-nowrap">
                            {WORD_TYPE_META[type].label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                  </TableCell>
                  <TableCell className="content-text !text-[16px] whitespace-nowrap px-3 py-3 sm:px-4 sm:py-4">{item.translation}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {strokeItem && (
        <StrokeOrderDialog
          key={strokeItem.id}
          chinese={strokeItem.chinese}
          pinyin={strokeItem.pinyin}
          translation={strokeItem.translation}
          showPinyin={settings.showPinyin}
          onClose={() => setStrokeItem(null)}
        />
      )}
    </div>
  );
}
