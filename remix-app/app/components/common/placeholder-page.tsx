import { AppShell } from "~/components/layout/app-shell";
import { EmptyState } from "~/components/common/empty-state";
import { Construction } from "lucide-react";
import type { SessionUser } from "~/lib/session.server";

interface PlaceholderPageProps {
  user: SessionUser;
  title: string;
  description: string;
  /** Icon minh hoạ cho mục này, mặc định dùng biểu tượng "đang xây dựng". */
  icon?: React.ReactNode;
}

/**
 * Trang tạm cho các mục menu đã có label nhưng chưa làm chi tiết.
 * Thay bằng nội dung thật khi triển khai từng mục.
 */
export function PlaceholderPage({ user, title, description, icon }: PlaceholderPageProps) {
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground text-sm mt-1">{description}</p>
        </div>
        <EmptyState
          title="Đang phát triển"
          message="Chức năng này sẽ được bổ sung trong thời gian tới."
          icon={icon ?? <Construction className="h-10 w-10" />}
        />
      </div>
    </AppShell>
  );
}
