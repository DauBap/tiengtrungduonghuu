import { EmptyState } from "~/components/common/empty-state";

/**
 * Nội dung tạm cho các tab soạn đề chưa làm xong.
 *
 * Khác `PlaceholderPage`: tab nằm trong layout `admin.exams.$examId.tsx` nên
 * không được bọc `AppShell` lần nữa (lồng hai sidebar).
 */
export function ExamTabPlaceholder({
  title,
  message,
  icon,
}: {
  title: string;
  message: string;
  icon: React.ReactNode;
}) {
  return <EmptyState title={title} message={message} icon={icon} />;
}
