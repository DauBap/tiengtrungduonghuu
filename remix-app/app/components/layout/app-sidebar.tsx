import { useEffect, useState } from "react";
import { Link, useLocation, useFetcher } from "react-router";
import { cn } from "~/lib/utils";
import { LayoutDashboard, BookOpen, TrendingUp, User, LogOut, Menu, X, Languages, School, ListChecks, FileCheck2, CalendarDays, Volume2 } from "lucide-react";
import type { UserRole, SessionUser } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { AppearanceMenu } from "~/components/layout/appearance-menu";

interface NavItem { label: string; href: string; icon: React.ComponentType<{ className?: string }>; }

const ROLE_NAV: Record<UserRole, NavItem[]> = {
  admin: [
    { label: "Bảng điều khiển", href: "/admin", icon: LayoutDashboard },
    { label: "Lớp học", href: "/admin/classes", icon: School },
    { label: "Khóa học", href: "/admin/courses", icon: BookOpen },
    { label: "Bài thi", href: "/admin/exams", icon: FileCheck2 },
    { label: "Kho câu hỏi", href: "/admin/question-bank", icon: ListChecks },
    { label: "Audio AI", href: "/admin/speech-audio", icon: Volume2 },
    { label: "Tài khoản", href: "/admin/accounts", icon: User },
  ],
  teacher: [
    { label: "Bảng điều khiển", href: "/teacher", icon: LayoutDashboard },
    { label: "Lịch dạy", href: "/teacher/schedule", icon: CalendarDays },
    { label: "Khóa học của tôi", href: "/teacher/courses", icon: BookOpen },
    { label: "Hồ sơ", href: "/teacher/profile", icon: User },
  ],
  student: [
    { label: "Bảng điều khiển", href: "/student", icon: LayoutDashboard },
    { label: "Lịch học", href: "/student/schedule", icon: CalendarDays },
    { label: "Khóa học của tôi", href: "/student/courses", icon: BookOpen },
  ],
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Trang quản trị", teacher: "Cổng giáo viên", student: "Trang học viên",
};

export function AppSidebar({ user }: { user: SessionUser }) {
  const location = useLocation();
  const fetcher = useFetcher();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = ROLE_NAV[user.role];
  const initials = user.name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) ?? "U";

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const SidebarContent = () => (
    <div className="flex h-full flex-col bg-sidebar-gradient text-sidebar-foreground">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar-foreground/15 text-sidebar-foreground backdrop-blur-sm">
          <Languages className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm font-bold tracking-tight">TIẾNG TRUNG DƯƠNG HỮU</p>
          <p className="text-xs text-sidebar-muted-foreground">{ROLE_LABEL[user.role]}</p>
        </div>
      </div>

      {/* overflow-y-auto: menu admin dài, cần cuộn được trên màn hình thấp */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const isActive = item.href === `/${user.role}` ? location.pathname === item.href : location.pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} to={item.href} onClick={() => setMobileOpen(false)}
              className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                // Sidebar đã là nền đỏ nên item active phải nổi bằng lớp sáng,
                // không dùng bg-primary (cùng tông đỏ → chìm hẳn vào nền).
                // Chữ dùng text-sidebar (không phải text-primary): ở dark mode
                // primary bị sáng lên nên trên viên pill trắng chỉ còn 3.5:1.
                isActive ? "bg-sidebar-foreground text-sidebar shadow-sm" : "text-sidebar-muted-foreground hover:bg-sidebar-muted hover:text-sidebar-foreground"
              )}>
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-3 rounded-lg px-3 py-2">
          <Avatar className="h-9 w-9 border border-sidebar-border">
            <AvatarFallback className="bg-sidebar-foreground/15 text-sidebar-foreground text-xs font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-sidebar-muted-foreground truncate">{user.email}</p>
          </div>
        </div>
        <div className="mt-2 space-y-1">
          <AppearanceMenu
            side="top"
            triggerLabel="Giao diện"
            triggerClassName="h-10 w-full justify-start gap-2 rounded-lg px-3 text-sm text-sidebar-muted-foreground hover:bg-sidebar-muted hover:text-sidebar-foreground"
          />
          <fetcher.Form method="post" action="/logout">
            <Button type="submit" variant="ghost" size="sm"
              className="h-10 w-full justify-start text-sidebar-muted-foreground hover:bg-sidebar-muted hover:text-sidebar-foreground">
              <LogOut className="h-4 w-4 mr-2" />
              Đăng xuất
            </Button>
          </fetcher.Form>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        type="button"
        className="fixed left-3 top-3 z-50 flex h-11 w-11 items-center justify-center rounded-lg border bg-background shadow-sm lg:hidden"
        onClick={() => setMobileOpen(true)}
        aria-label="Mở menu"
        aria-expanded={mobileOpen}
      >
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 h-full w-full cursor-default bg-black/50"
            onClick={() => setMobileOpen(false)}
            aria-label="Đóng menu"
          />
          <div className="absolute left-0 top-0 h-full w-[min(18rem,85vw)]">
            <button type="button" className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-muted"
              onClick={() => setMobileOpen(false)}>
              <X className="h-5 w-5" />
            </button>
            <SidebarContent />
          </div>
        </div>
      )}

      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">
        <SidebarContent />
      </aside>
    </>
  );
}
