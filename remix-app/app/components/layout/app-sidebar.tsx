import { useState } from "react";
import { Link, useLocation, useFetcher } from "react-router";
import { cn } from "~/lib/utils";
import { LayoutDashboard, BookOpen, Users, Settings, TrendingUp, User, LogOut, Menu, X, Languages, Briefcase, GraduationCap, School, CalendarDays, Wallet, ClipboardCheck, ChartColumn, Bell } from "lucide-react";
import type { UserRole, SessionUser } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";

interface NavItem { label: string; href: string; icon: React.ComponentType<{ className?: string }>; }

const ROLE_NAV: Record<UserRole, NavItem[]> = {
  admin: [
    { label: "Bảng điều khiển", href: "/admin", icon: LayoutDashboard },
    { label: "Nhân viên", href: "/admin/staff", icon: Briefcase },
    { label: "Giáo viên", href: "/admin/teachers", icon: GraduationCap },
    { label: "Học viên", href: "/admin/students", icon: Users },
    { label: "Lớp học", href: "/admin/classes", icon: School },
    { label: "Khóa học", href: "/admin/courses", icon: BookOpen },
    { label: "Thời khóa biểu", href: "/admin/schedule", icon: CalendarDays },
    { label: "Học phí", href: "/admin/tuition", icon: Wallet },
    { label: "Điểm danh", href: "/admin/attendance", icon: ClipboardCheck },
    { label: "Báo cáo", href: "/admin/reports", icon: ChartColumn },
    { label: "Thông báo", href: "/admin/notifications", icon: Bell },
    { label: "Tài khoản", href: "/admin/accounts", icon: User },
    { label: "Cài đặt", href: "/admin/settings", icon: Settings },
  ],
  teacher: [
    { label: "Bảng điều khiển", href: "/teacher", icon: LayoutDashboard },
    { label: "Khóa học của tôi", href: "/teacher/courses", icon: BookOpen },
    { label: "Hồ sơ", href: "/teacher/profile", icon: User },
  ],
  student: [
    { label: "Bảng điều khiển", href: "/student", icon: LayoutDashboard },
    { label: "Khóa học của tôi", href: "/student/courses", icon: BookOpen },
    { label: "Tiến độ", href: "/student/progress", icon: TrendingUp },
    { label: "Hồ sơ", href: "/student/profile", icon: User },
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
        <fetcher.Form method="post" action="/logout">
          <Button type="submit" variant="ghost" size="sm"
            className="w-full mt-2 justify-start text-sidebar-muted-foreground hover:bg-sidebar-muted hover:text-sidebar-foreground">
            <LogOut className="h-4 w-4 mr-2" />
            Đăng xuất
          </Button>
        </fetcher.Form>
      </div>
    </div>
  );

  return (
    <>
      <button className="fixed left-4 top-4 z-50 lg:hidden flex h-10 w-10 items-center justify-center rounded-lg border bg-background shadow-sm"
        onClick={() => setMobileOpen(true)} aria-label="Mở menu">
        <Menu className="h-5 w-5" />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full w-72">
            <button className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground hover:bg-sidebar-muted"
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
