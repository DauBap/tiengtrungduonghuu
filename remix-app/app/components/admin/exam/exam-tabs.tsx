import { NavLink } from "react-router";
import { cn } from "~/lib/utils";
import {
  LayoutGrid, Layers, ListChecks, SlidersHorizontal, BarChart3, Eye,
} from "lucide-react";

/**
 * Sáu tab của màn hình soạn đề.
 *
 * Khai báo một chỗ để thứ tự và nhãn không lệch giữa các trang. `end` cho tab
 * đầu vì đường dẫn của nó là tiền tố của mọi tab còn lại.
 */
const TABS = [
  { to: "", label: "Tổng quan", icon: LayoutGrid, end: true },
  { to: "structure", label: "Cấu trúc", icon: Layers, end: false },
  { to: "questions", label: "Câu hỏi", icon: ListChecks, end: false },
  { to: "settings", label: "Cài đặt", icon: SlidersHorizontal, end: false },
  { to: "results", label: "Kết quả", icon: BarChart3, end: false },
  { to: "preview", label: "Xem thử", icon: Eye, end: false },
] as const;

export function ExamTabs({ examId }: { examId: string }) {
  return (
    <div className="border-b">
      <nav className="flex gap-1 overflow-x-auto -mb-px">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <NavLink
              key={tab.to || "index"}
              to={`/admin/exams/${examId}${tab.to ? `/${tab.to}` : ""}`}
              end={tab.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  isActive
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
