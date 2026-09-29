import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, Link } from "react-router";
import { requireRole } from "~/lib/session.server";
import { getEnrolledCourses, getLessonsByCourse } from "~/lib/db.server";
import { AppShell } from "~/components/layout/app-shell";
import { ProgressBar } from "~/components/progress/progress-bar";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { TrendingUp, BookOpen, CheckCircle2, MessageSquareText } from "lucide-react";
import { LESSON_TAB_KEYS } from "~/lib/lesson-tab-progress";
import { prisma } from "~/lib/prisma.server";

const TAB_LABELS: Record<(typeof LESSON_TAB_KEYS)[number], string> = {
  FLASHCARD: "Flashcard",
  VOCABULARY_TEST: "Ôn từ",
  LISTENING: "Nghe câu",
  VOCABULARY: "Từ vựng",
  LESSON: "Bài học",
  GRAMMAR: "Ngữ pháp",
  WORKBOOK: "Workbook",
};

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const myCourses = await getEnrolledCourses(user.id);
  const coursesAndLessons = await Promise.all(
    myCourses.map(async (course) => ({ course, lessons: await getLessonsByCourse(course.id) })),
  );
  const lessonIds = coursesAndLessons.flatMap(({ lessons }) => lessons.map((lesson) => lesson.id));
  const progressRows = lessonIds.length === 0
    ? []
    : await prisma.lessonTabProgress.findMany({
        where: { userId: user.id, lessonId: { in: lessonIds } },
        include: {
          attempts: {
            where: { tab: "VOCABULARY_TEST" },
            orderBy: { completedAt: "desc" },
            take: 1,
          },
          feedback: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { teacher: { select: { name: true } } },
          },
        },
      });

  const progressByLesson = new Map<string, typeof progressRows>();
  for (const row of progressRows) {
    const rows = progressByLesson.get(row.lessonId) ?? [];
    rows.push(row);
    progressByLesson.set(row.lessonId, rows);
  }

  let totalTrackedTabs = 0;
  let totalCompletedTabs = 0;
  const coursesWithProgress = coursesAndLessons.map(({ course, lessons }) => {
    const lessonsWithProgress = lessons.map((lesson) => {
      const rows = progressByLesson.get(lesson.id) ?? [];
      const tabs = LESSON_TAB_KEYS.map((tab) => {
        const row = rows.find((item) => item.tab === tab);
        const latestAttempt = tab === "VOCABULARY_TEST" ? row?.attempts[0] : undefined;
        const completed = tab === "VOCABULARY_TEST" ? latestAttempt?.passed === true : row?.completed === true;
        const state = completed ? "COMPLETED" : row?.opened ? "IN_PROGRESS" : "NOT_STARTED";
        const statusLabel = tab === "VOCABULARY_TEST"
          ? latestAttempt?.passed === true
            ? "Đạt"
            : latestAttempt?.passed === false
              ? "Chưa đạt"
              : row?.opened
                ? "Đang học"
                : "Chưa bắt đầu"
          : state === "COMPLETED"
            ? "Hoàn thành"
            : state === "IN_PROGRESS"
              ? "Đang học"
              : "Chưa bắt đầu";

        return {
          key: tab,
          label: TAB_LABELS[tab],
          statusLabel,
          completed,
          currentScore: latestAttempt?.score ?? row?.currentScore ?? null,
          correctCount: latestAttempt?.correctCount ?? null,
          totalCount: latestAttempt?.totalCount ?? null,
          teacherComment: tab !== "FLASHCARD" && tab !== "VOCABULARY" && row?.feedback[0]
            ? {
                comment: row.feedback[0].comment,
                teacherName: row.feedback[0].teacher.name,
                createdAt: row.feedback[0].createdAt.toISOString(),
              }
            : null,
        };
      });
      const completedTabs = tabs.filter((tab) => tab.completed).length;
      totalTrackedTabs += LESSON_TAB_KEYS.length;
      totalCompletedTabs += completedTabs;

      return { ...lesson, tabs, completedTabs };
    });
    const courseCompletedTabs = lessonsWithProgress.reduce((sum, lesson) => sum + lesson.completedTabs, 0);
    const courseTotalTabs = lessonsWithProgress.length * LESSON_TAB_KEYS.length;
    const courseProgress = courseTotalTabs > 0 ? Math.round((courseCompletedTabs / courseTotalTabs) * 100) : 0;

    return {
      course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
      courseProgress,
      lessons: lessonsWithProgress,
    };
  });

  const overallProgress = totalTrackedTabs > 0 ? Math.round((totalCompletedTabs / totalTrackedTabs) * 100) : 0;
  return { user, coursesWithProgress, overallProgress, totalTrackedTabs, totalCompletedTabs };
}

export default function StudentProgress() {
  const { user, coursesWithProgress, overallProgress, totalTrackedTabs, totalCompletedTabs } = useLoaderData<typeof loader>();
  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tiến độ của tôi</h1>
          <p className="text-muted-foreground text-sm mt-1">Theo dõi hành trình học tập của bạn qua các khóa học.</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2"><TrendingUp className="h-4 w-4" />Tổng tiến độ</CardTitle>
          </CardHeader>
          <CardContent>
            <ProgressBar value={overallProgress} className="max-w-md" />
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground"><BookOpen className="h-4 w-4" /><span className="text-xs font-medium">Tổng phần học</span></div>
                <p className="text-2xl font-bold mt-1">{totalTrackedTabs}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground"><CheckCircle2 className="h-4 w-4" /><span className="text-xs font-medium">Đã hoàn thành</span></div>
                <p className="text-2xl font-bold mt-1">{totalCompletedTabs}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {coursesWithProgress.map(({ course, courseProgress, lessons }) => (
          <Card key={course.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link to={`/student/courses/${course.id}`} className="hover:text-primary transition-colors">{course.title}</Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ProgressBar value={courseProgress} />
              <div className="space-y-2">
                {lessons.map((lesson, index) => (
                  <div key={lesson.id} className="space-y-3 rounded-lg border p-3">
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-xs font-mono text-muted-foreground">B{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{lesson.title}</p>
                        <p className="truncate text-xs text-muted-foreground font-mono">{lesson.subtitle}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">{lesson.completedTabs}/{LESSON_TAB_KEYS.length}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 pl-11">
                      {lesson.tabs.map((tab) => (
                        <span
                          key={tab.key}
                          title={`${tab.label}: ${tab.statusLabel}${tab.correctCount != null && tab.totalCount != null ? ` · ${tab.correctCount}/${tab.totalCount}` : ""}`}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${
                            tab.completed
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : tab.statusLabel === "Chưa đạt" || tab.statusLabel === "Đang học"
                                ? "border-amber-200 bg-amber-50 text-amber-700"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                          }`}
                        >
                          {tab.label}
                          {tab.key === "VOCABULARY_TEST" && tab.correctCount != null && tab.totalCount != null
                            ? ` ${tab.correctCount}/${tab.totalCount}`
                            : ` · ${tab.statusLabel}`}
                        </span>
                      ))}
                    </div>
                    {lesson.tabs.some((tab) => tab.teacherComment) && (
                      <div className="space-y-2 border-t pt-3 pl-11">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                          <MessageSquareText className="h-3.5 w-3.5" />Nhận xét của giáo viên
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {lesson.tabs.filter((tab) => tab.teacherComment).map((tab) => (
                            <div key={tab.key} className="rounded-md border bg-background p-2.5">
                              <p className="text-[11px] font-semibold text-primary">{tab.label}</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm">{tab.teacherComment?.comment}</p>
                              <p className="mt-1.5 text-[10px] text-muted-foreground">
                                {tab.teacherComment?.teacherName ?? "Giáo viên"}
                                {tab.teacherComment?.createdAt && ` · ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(tab.teacherComment.createdAt))}`}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}
