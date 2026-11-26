import { useEffect, useState } from "react";
import { Link, useLocation, useFetcher } from "react-router";
import { cn } from "~/lib/utils";
import { LayoutDashboard, BookOpen, User, Users, LogOut, Menu, X, School, ListChecks, FileCheck2, CalendarDays, Volume2, ClipboardCheck, Brush, GraduationCap, ClipboardList, ChevronDown, Gamepad2, TrendingUp, Video } from "lucide-react";
import type { UserRole, SessionUser } from "~/lib/session.server";
import { Button } from "~/components/ui/button";
import { Avatar, AvatarFallback } from "~/components/ui/avatar";
import { AppearanceMenu } from "~/components/layout/appearance-menu";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: Omit<NavItem, "children">[];
}

const ROLE_NAV: Record<UserRole, NavItem[]> = {
  admin: [
    { label: "Bảng điều khiển", href: "/admin", icon: LayoutDashboard },
    {
      label: "Quản lý trò chơi",
      href: "/admin/shen-bi-data",
      icon: Gamepad2,
      children: [
        { label: "Dữ liệu Thần Bút", href: "/admin/shen-bi-data", icon: Brush },
      ],
    },
    {
      label: "Quản lý lớp học",
      href: "/admin/classes",
      icon: School,
      children: [
        { label: "Danh sách lớp", href: "/admin/classes", icon: School },
        { label: "Tổng quan lớp", href: "/admin/class-overview", icon: ClipboardList },
        { label: "Điểm danh", href: "/admin/attendance", icon: ClipboardCheck },
        { label: "Link buổi học", href: "/admin/session-links", icon: Video },
        { label: "Kiểm tra chất lượng bài dạy", href: "/admin/teaching-quality", icon: ClipboardCheck },
        { label: "Duyệt yêu cầu nghỉ", href: "/admin/leave-requests", icon: CalendarDays },
      ],
    },
    {
      label: "Quản lý học sinh",
      href: "/admin/midterm-reviews",
      icon: Users,
      children: [
        { label: "Đánh giá giữa kỳ", href: "/admin/midterm-reviews", icon: ClipboardCheck },
        { label: "Đánh giá cuối kỳ", href: "/admin/class-final-results", icon: ClipboardCheck },
        { label: "Lịch sử đánh giá học viên", href: "/admin/student-reviews", icon: ClipboardList },
        { label: "Bài chưa chấm", href: "/admin/grading-overview", icon: ClipboardList },
      ],
    },
    {
      label: "Lịch & phân công",
      href: "/admin/teachers",
      icon: GraduationCap,
      children: [
        { label: "Lịch giáo viên", href: "/admin/teachers", icon: CalendarDays },
      ],
    },
    {
      label: "Nội dung & kiểm tra",
      href: "/admin/courses",
      icon: BookOpen,
      children: [
        { label: "Khóa học", href: "/admin/courses", icon: BookOpen },
        { label: "Bài thi", href: "/admin/exams", icon: FileCheck2 },
        { label: "Kho câu hỏi", href: "/admin/question-bank", icon: ListChecks },
        { label: "Duyệt góp ý nội dung", href: "/admin/content-corrections", icon: ClipboardList },
      ],
    },
    { label: "Audio AI", href: "/admin/speech-audio", icon: Volume2 },
    { label: "Tài khoản", href: "/admin/accounts", icon: User },
  ],
  teacher: [
    { label: "Bảng điều khiển", href: "/teacher", icon: LayoutDashboard },
    { label: "Lớp & Học viên", href: "/teacher/classes", icon: School },
    { label: "Tiến độ & Nhắc nhở", href: "/teacher/progress", icon: TrendingUp },
    { label: "Lịch dạy", href: "/teacher/schedule", icon: CalendarDays },
    { label: "Điểm danh", href: "/teacher/attendance", icon: ClipboardCheck },
    { label: "Xin nghỉ phép", href: "/teacher/leave-requests", icon: CalendarDays },
    { label: "Khóa học của tôi", href: "/teacher/courses", icon: BookOpen },
    { label: "Góp ý nội dung", href: "/teacher/content-corrections", icon: ListChecks },
  ],
  student: [
    { label: "Bảng điều khiển", href: "/student", icon: LayoutDashboard },
    { label: "Bài cần chấm", href: "/student/assignments", icon: ClipboardCheck },
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
  const reviewCountFetcher = useFetcher<{ count: number }>();
  const [mobileOpen, setMobileOpen] = useState(false);
  const navItems = ROLE_NAV[user.role];
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(() => Object.fromEntries(
    navItems
      .filter((item) => item.children)
      .map((item) => [
        item.href,
        location.pathname.startsWith(item.href)
          || item.children?.some((child) => location.pathname.startsWith(child.href)) === true,
      ]),
  ));
  const initials = user.name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) ?? "U";
  const pendingReviewCount = reviewCountFetcher.data?.count ?? 0;

  useEffect(() => {
    const activeGroup = navItems.find((item) =>
      item.children
      && (location.pathname.startsWith(item.href)
        || item.children.some((child) => location.pathname.startsWith(child.href)))
    );
    if (activeGroup) {
      setExpandedGroups((current) => Object.fromEntries(
        Object.keys(current).map((href) => [href, href === activeGroup.href]),
      ));
    }
  }, [location.pathname, navItems]);

  useEffect(() => {
    if (user.role !== "student") return;
    const refresh = () => reviewCountFetcher.load("/api/student/review-count");
    refresh();
    const intervalId = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, [location.pathname, user.role]);

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
      <div className="flex items-center gap-3 border-b border-sidebar-border px-6 py-5">
        <img
          src="/logo-duong-huu.webp"
          alt=""
          aria-hidden="true"
          className="h-10 w-10 shrink-0 rounded-full object-contain"
        />
        <div>
          <p className="text-sm font-bold tracking-tight">TIẾNG TRUNG DƯƠNG HỮU</p>
          <p className="text-xs text-sidebar-muted-foreground">{ROLE_LABEL[user.role]}</p>
        </div>
      </div>

      {/* overflow-y-auto: menu admin dài, cần cuộn được trên màn hình thấp */}
      <nav className="sidebar-scrollbar flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const isChildActive = item.children?.some((child) => location.pathname.startsWith(child.href)) ?? false;
          const isActive = item.href === `/${user.role}`
            ? location.pathname === item.href
            : location.pathname.startsWith(item.href) || isChildActive;
          const isExpanded = item.children
            ? expandedGroups[item.href] ?? (isActive || isChildActive)
            : false;
          const Icon = item.icon;
          return (
            <div key={item.href}>
              {item.children ? (
                <button
                  type="button"
                  aria-expanded={isExpanded}
                  aria-controls={`sidebar-submenu-${item.href.replaceAll("/", "-")}`}
                  onClick={() => setExpandedGroups((current) => Object.fromEntries(
                    Object.keys(current).map((href) => [href, href === item.href && !isExpanded]),
                  ))}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-sidebar-muted-foreground transition-colors hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <ChevronDown className={cn("sidebar-submenu-chevron h-4 w-4 shrink-0", !isExpanded && "-rotate-90")} />
                </button>
              ) : (
                <Link
                  to={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-sidebar-foreground text-sidebar shadow-sm"
                      : "text-sidebar-muted-foreground hover:bg-sidebar-muted hover:text-sidebar-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {user.role === "student" && item.href === "/student/assignments" && pendingReviewCount > 0 && (
                    <span
                      aria-label={`${pendingReviewCount} bài đang chờ chấm`}
                      className={cn(
                        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums",
                        isActive
                          ? "bg-sidebar text-sidebar-foreground"
                          : "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
                      )}
                    >
                      {pendingReviewCount > 99 ? "99+" : pendingReviewCount}
                    </span>
                  )}
                </Link>
              )}
              {item.children && (
                <div
                  id={`sidebar-submenu-${item.href.replaceAll("/", "-")}`}
                  className="sidebar-submenu"
                  data-open={isExpanded}
                  aria-hidden={!isExpanded}
                >
                  <div className="sidebar-submenu-content">
                    <div className="ml-3 mt-1 space-y-1 border-l border-sidebar-border pl-3">
                      {item.children.map((child) => {
                        const isChildSelected = location.pathname.startsWith(child.href);
                        const ChildIcon = child.icon;
                        return (
                          <Link
                            key={child.href}
                            to={child.href}
                            onClick={() => setMobileOpen(false)}
                            aria-current={isChildSelected ? "page" : undefined}
                            tabIndex={isExpanded ? undefined : -1}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                              isChildSelected
                                ? "bg-sidebar-foreground text-sidebar shadow-sm"
                                : "text-sidebar-muted-foreground hover:bg-sidebar-muted hover:text-sidebar-foreground",
                            )}
                          >
                            <ChildIcon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 truncate">{child.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
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

      <aside className="fixed inset-y-0 left-0 z-40 hidden h-dvh w-64 lg:block">
        <SidebarContent />
      </aside>
    </>
  );
}
