import { AppSidebar } from "~/components/layout/app-sidebar";
import { GradingNotifications } from "~/components/layout/grading-notifications";
import { PresenceTracker } from "~/components/layout/presence-tracker";
import type { SessionUser } from "~/lib/session.server";

interface AppShellProps {
  user: SessionUser;
  children: React.ReactNode;
  attendanceLayout?: boolean;
}

export function AppShell({ user, children, attendanceLayout = false }: AppShellProps) {
  return (
    <div className={`flex min-h-screen ${attendanceLayout ? "flex-col bg-background lg:flex-row" : "bg-background"}`}>
      {user.role !== "admin" && <PresenceTracker />}
      <AppSidebar user={user} />
      <GradingNotifications />
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {attendanceLayout ? children : (
          <main className="min-w-0 flex-1 p-4 pt-16 animate-fade-in sm:p-6 sm:pt-16 lg:p-8">
            {children}
          </main>
        )}
      </div>
    </div>
  );
}
