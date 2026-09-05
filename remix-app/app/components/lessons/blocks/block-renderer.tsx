import { useFetcher } from "react-router";
import { BlockShell } from "./block-shell";
import { FlashcardBlock, type FlashcardVocab } from "./flashcard-block";
import { parseFlashcardConfig, BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";
import type { ProgressStatus } from "~/types/progress";
import { Construction, Lock, Inbox } from "lucide-react";

/** Block đã được loader resolve sẵn từ vựng — component không tự query */
export interface ResolvedBlock {
  id: string;
  type: LearningBlockType;
  title: string;
  description: string | null;
  required: boolean;
  order: number;
  config: unknown;
  vocabItems: FlashcardVocab[];
}

/**
 * Block có nội dung học được hay không.
 * Dùng ở loader để loại block rỗng khỏi tiến độ bắt buộc, và ở renderer để
 * quyết định hiện thẻ hay hiện trạng thái trống. Hai nơi phải dùng chung một
 * hàm, nếu lệch nhau học viên sẽ thấy block "bắt buộc" mà không thể hoàn thành.
 */
export function isBlockLearnable(block: Pick<ResolvedBlock, "type" | "config" | "vocabItems">): boolean {
  if (block.type !== "FLASHCARD") return false; // các dạng khác chưa làm
  const parsed = parseFlashcardConfig(block.config);
  return parsed.ok && block.vocabItems.length > 0;
}

export function BlockRenderer({ block, status }: { block: ResolvedBlock; status: ProgressStatus }) {
  const fetcher = useFetcher();
  const isCompleted = status === "COMPLETED";

  const markComplete = () => {
    fetcher.submit({ intent: "complete-block", blockId: block.id }, { method: "post" });
  };

  const shellProps = {
    type: block.type,
    title: block.title,
    description: block.description,
    status,
    required: block.required,
  };

  if (status === "LOCKED") {
    return (
      <BlockShell {...shellProps}>
        <div className="flex items-center gap-2 justify-center py-8 text-sm text-muted-foreground">
          <Lock className="h-4 w-4" />
          Hoàn thành phần trước để mở khóa
        </div>
      </BlockShell>
    );
  }

  if (block.type === "FLASHCARD") {
    const parsed = parseFlashcardConfig(block.config);
    // Config lỗi hoặc chưa có từ nào → với học viên đều chỉ là "chưa có nội dung".
    // Không hiện message validate của zod: đó là thông tin dành cho admin.
    if (!parsed.ok) {
      return (
        <BlockShell {...shellProps}>
          <BlockEmpty />
        </BlockShell>
      );
    }
    // Sắp thẻ theo đúng thứ tự admin đã chọn trong config
    const order = new Map(parsed.data.vocabItemIds.map((id, i) => [id, i]));
    const items = [...block.vocabItems].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

    if (items.length === 0) {
      return (
        <BlockShell {...shellProps}>
          <BlockEmpty />
        </BlockShell>
      );
    }

    return (
      <BlockShell {...shellProps}>
        <FlashcardBlock config={parsed.data} items={items} isCompleted={isCompleted} onComplete={markComplete} />
      </BlockShell>
    );
  }

  // Các dạng chưa hoàn thiện
  return (
    <BlockShell {...shellProps}>
      <div className="rounded-lg border-2 border-dashed border-primary/20 bg-primary/5 p-8 text-center">
        <div className="flex justify-center mb-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Construction className="h-6 w-6" />
          </div>
        </div>
        <p className="text-sm font-medium">Dạng &quot;{BLOCK_META[block.type].label}&quot; đang được phát triển</p>
        <p className="text-sm text-muted-foreground mt-1">Nội dung sẽ được bổ sung trong thời gian tới.</p>
      </div>
    </BlockShell>
  );
}

/** Phần học chưa có nội dung — dùng cho cả config lỗi và config rỗng. */
function BlockEmpty() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <div className="flex justify-center mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Inbox className="h-6 w-6" />
        </div>
      </div>
      <p className="text-sm font-medium">Phần học này đang trống</p>
      <p className="text-sm text-muted-foreground mt-1">Nội dung sẽ được bổ sung trong thời gian tới.</p>
    </div>
  );
}
