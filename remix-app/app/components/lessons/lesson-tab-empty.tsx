import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "~/components/common/empty-state";
import { BLOCK_META, type LearningBlockType } from "~/lib/learning-blocks";
import type { LessonTab } from "./lesson-tabs";

/**
 * Icon + nhãn cho một tab bất kỳ.
 * Tab Kiểm tra không phải LearningBlockType nên không có trong BLOCK_META,
 * phải khai riêng — icon giữ đúng cái đang dùng trên thanh tab.
 */
function tabMeta(tab: LessonTab) {
  if (tab === "TEST") {
    return { icon: ClipboardCheck, label: "Kiểm tra", implemented: true };
  }
  const meta = BLOCK_META[tab as LearningBlockType];
  return { icon: meta.icon, label: meta.label, implemented: meta.implemented };
}

interface LessonTabEmptyProps {
  tab: LessonTab;
}

/**
 * Trạng thái trống dùng chung cho cả 6 tab của bài học.
 *
 * Trước đây mỗi tab tự vẽ một khung khác nhau (viền dashed primary, viền xám,
 * Card, hay chỉ một dòng chữ xám) nên nhìn không thống nhất. Mọi tab giờ đi qua
 * đây: cùng khung, cùng cỡ chữ, cùng bề rộng — chỉ icon và nhãn đổi theo tab.
 *
 * Dạng chưa hỗ trợ (`implemented: false`) nói "đang được phát triển", dạng đã
 * hỗ trợ nhưng bài chưa soạn thì nói "chưa có" — phân biệt này cần giữ, vì hai
 * trường hợp đó học viên chờ hai thứ khác nhau.
 */
export function LessonTabEmpty({ tab }: LessonTabEmptyProps) {
  const { icon: Icon, label, implemented } = tabMeta(tab);

  return (
    <div className="max-w-3xl mx-auto">
      <EmptyState
        icon={
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted">
            <Icon className="h-7 w-7" />
          </div>
        }
        title={implemented ? `Bài này chưa có phần ${label}` : `Dạng "${label}" đang được phát triển`}
        message="Nội dung sẽ được bổ sung trong thời gian tới."
      />
    </div>
  );
}
