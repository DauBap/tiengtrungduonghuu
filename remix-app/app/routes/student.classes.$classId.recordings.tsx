import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowLeft, ArrowUpRight, Video } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const classId = params.classId;
  if (!classId) throw new Response("Not Found", { status: 404 });
  const enrollment = await prisma.enrollment.findFirst({
    where: { userId: user.id, classId },
    select: {
      class: {
        select: {
          id: true,
          name: true,
          course: { select: { code: true, title: true } },
          teacher: { select: { name: true } },
          attendanceSessions: {
            orderBy: [{ date: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              title: true,
              lesson: true,
              date: true,
              recordingUrl: true,
              courseLesson: { select: { order: true, title: true } },
            },
          },
        },
      },
    },
  });
  if (!enrollment?.class) throw new Response("Not Found", { status: 404 });
  const sessions = enrollment.class.attendanceSessions.map((session) => {
    let recordingUrl: string | null = null;
    if (session.recordingUrl) {
      try {
        const url = new URL(session.recordingUrl);
        if (url.protocol === "https:" || url.protocol === "http:") recordingUrl = url.toString();
      } catch {
        recordingUrl = null;
      }
    }
    return { ...session, recordingUrl };
  });
  return { user, classroom: { ...enrollment.class, attendanceSessions: sessions } };
}

export default function StudentClassRecordings() {
  const { user, classroom } = useLoaderData<typeof loader>();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-4xl space-y-6">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to="/student"><ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />Về bảng điều khiển</Link>
        </Button>
        <header className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Bản ghi buổi học</h1>
          <p className="text-sm text-muted-foreground">
            {classroom.name} · {classroom.course.code}
            {classroom.teacher && <> · Giáo viên: {classroom.teacher.name}</>}
          </p>
        </header>

        {classroom.attendanceSessions.length === 0 ? (
          <div className="rounded-lg border border-dashed px-5 py-10 text-center">
            <Video aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">Chưa có buổi học hoặc bản ghi</p>
            <p className="mt-1 text-sm text-muted-foreground">Khi giáo viên đăng link, buổi học sẽ xuất hiện tại đây.</p>
          </div>
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {classroom.attendanceSessions.map((session) => (
              <li key={session.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <h2 className="font-medium">{session.title}</h2>
                  {(session.courseLesson || session.lesson) && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {session.courseLesson
                        ? `Bài ${session.courseLesson.order} · ${session.courseLesson.title}`
                        : session.lesson}
                    </p>
                  )}
                  <time className="mt-1 block text-sm text-muted-foreground">{session.date.toLocaleDateString("vi-VN")}</time>
                </div>
                {session.recordingUrl ? (
                  <a
                    href={session.recordingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Xem bản ghi<ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                  </a>
                ) : (
                  <span className="text-sm text-muted-foreground">Chưa có bản ghi</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </AppShell>
  );
}
