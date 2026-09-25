import { useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { PenLine, Volume2 } from "lucide-react";
import { speakChinese } from "~/lib/speech";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";
import { LessonTabEmpty } from "./lesson-tab-empty";
import { StrokeOrderDialog, splitHanCharacters } from "./stroke-order-dialog";

interface VocabularyItem {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordTypes: WordType[];
  audioUrl: string | null;
}

interface VocabularyTableProps {
  items: VocabularyItem[];
}

export function VocabularyTable({ items }: VocabularyTableProps) {
  // Từ đang xem cách viết; null = đóng hộp thoại.
  const [strokeItem, setStrokeItem] = useState<VocabularyItem | null>(null);

  if (items.length === 0) return <LessonTabEmpty tab="VOCABULARY" />;

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12 text-center">STT</TableHead>
            {/* Chữ Hán + 2 nút cần chỗ: w-32 cũ làm chữ bị bẻ dòng giữa từ */}
            <TableHead className="w-48">Chữ Hán</TableHead>
            <TableHead className="w-32">Pinyin</TableHead>
            <TableHead className="w-20">Từ loại</TableHead>
            <TableHead>Nghĩa tiếng Việt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item, index) => (
            <TableRow key={item.id}>
              <TableCell className="text-center font-mono text-sm text-muted-foreground tabular-nums">
                {index + 1}
              </TableCell>
              <TableCell className="font-semibold text-lg">
                <div className="flex items-center gap-1.5">
                  {/* Chữ Hán ngắt dòng được ở mọi ký tự nên phải chặn tay */}
                  <span className="whitespace-nowrap">{item.chinese}</span>
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
              <TableCell className="font-mono text-sm text-primary">{item.pinyin}</TableCell>
              <TableCell>
                {item.wordTypes?.length ? (
                  <div className="flex flex-wrap gap-1">
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
              <TableCell>{item.translation}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {strokeItem && (
        <StrokeOrderDialog
          key={strokeItem.id}
          chinese={strokeItem.chinese}
          pinyin={strokeItem.pinyin}
          translation={strokeItem.translation}
          onClose={() => setStrokeItem(null)}
        />
      )}
    </div>
  );
}
