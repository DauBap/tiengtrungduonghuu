import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Volume2 } from "lucide-react";
import { speakChinese } from "~/lib/speech";
import { WORD_TYPE_META, type WordType } from "~/lib/word-types";

interface VocabularyItem {
  id: string;
  chinese: string;
  pinyin: string;
  translation: string;
  wordType: WordType | null;
  audioUrl: string | null;
}

interface VocabularyTableProps {
  items: VocabularyItem[];
}

export function VocabularyTable({ items }: VocabularyTableProps) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Chưa có từ vựng nào
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-32">Tiếng Trung</TableHead>
            <TableHead className="w-32">Pinyin</TableHead>
            <TableHead className="w-20">Từ loại</TableHead>
            <TableHead>Nghĩa tiếng Việt</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="font-semibold text-lg">
                <div className="flex items-center gap-2">
                  <span>{item.chinese}</span>
                  {item.audioUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => speakChinese(item.chinese, item.audioUrl)}
                      title="Nghe phát âm"
                    >
                      <Volume2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-sm text-primary">{item.pinyin}</TableCell>
              <TableCell>
                {item.wordType ? (
                  <Badge variant="outline" className="text-xs whitespace-nowrap">
                    {WORD_TYPE_META[item.wordType].label}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell>{item.translation}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
