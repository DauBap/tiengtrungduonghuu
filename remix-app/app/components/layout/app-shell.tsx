import { AppSidebar } from "~/components/layout/app-sidebar";
import { GradingNotifications } from "~/components/layout/grading-notifications";
import type { SessionUser } from "~/lib/session.server";

interface AppShellProps {
  user: SessionUser;
  children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen bg-background">
      <AppSidebar user={user} />
      {user.role !== "admin" && <GradingNotifications />}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <main className="min-w-0 flex-1 p-4 pt-16 animate-fade-in sm:p-6 sm:pt-16 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
