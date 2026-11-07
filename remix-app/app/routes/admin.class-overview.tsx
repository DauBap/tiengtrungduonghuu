import { useEffect, useMemo, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { ArrowUpRight, CheckCircle2, ChevronDown, Circle, Search, Video, X } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { formatSchedule } from "~/lib/schedule-utils";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const [classes, completedClassesWithResults, hskLevels] = await Promise.all([
    prisma.class.findMany({
      where: { completedAt: null },
      select: {
        id: true,
        name: true,
        schedule: true,
        course: {
          select: {
            id: true,
            hskLevel: true,
            code: true,
            title: true,
            lessons: {
              orderBy: { order: "asc" },
              select: { id: true, title: true, order: true },
            },
          },
        },
        teacher: { select: { id: true, name: true } },
        maxStudents: true,
        _count: {
          select: {
            enrollments: {
              where: { user: { is: { role: "student", deletedAt: null } } },
            },
          },
        },
        enrollments: {
          where: { user: { is: { role: "student", deletedAt: null } } },
          orderBy: { createdAt: "asc" },
          select: {
            user: {
              select: {
                id: true,
                name: true,
                isActive: true,
                isActivated: true,
                enrollments: {
                  where: { classId: { not: null } },
                  select: { course: { select: { hskLevel: true } } },
                },
              },
            },
          },
        },
        attendanceSessions: {
          orderBy: [{ date: "desc" }, { createdAt: "desc" }],
          select: {
            id: true,
            lessonId: true,
            title: true,
            lesson: true,
            date: true,
            recordingUrl: true,
            records: { select: { studentId: true, status: true } },
          },
        },
        studentScores: { select: { studentId: true, score: true } },
      },
      orderBy: [{ course: { order: "asc" } }, { name: "asc" }],
    }),
    prisma.class.findMany({
      where: { completedAt: { not: null }, finalResults: { some: {} } },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        name: true,
        completedAt: true,
        course: { select: { hskLevel: true, code: true } },
        teacher: { select: { name: true } },
        finalResults: {
          orderBy: { student: { name: "asc" } },
          select: {
            score: true,
            comment: true,
            attendedSessions: true,
            totalSessions: true,
            decision: true,
            student: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.course.findMany({
      distinct: ["hskLevel"],
      orderBy: { hskLevel: "asc" },
      select: { hskLevel: true },
    }),
  ]);
  const hskCounts = hskLevels.map(({ hskLevel }) => ({
    hskLevel,
    count: classes.filter(({ course }) => course.hskLevel === hskLevel).length,
  }));
  return { user, classes, completedClassesWithResults, hskCounts };
}

function getSafeRecordUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default function AdminClassOverview() {
  const { user, classes, completedClassesWithResults, hskCounts } = useLoaderData<typeof loader>();
  const [query, setQuery] = useState("");
  const [selectedHsk, setSelectedHsk] = useState("");
  const [selectedTeacher, setSelectedTeacher] = useState("");
  const [selectedRecordClassId, setSelectedRecordClassId] = useState<string | null>(null);
  const teacherCounts = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const classroom of classes) {
      if (selectedHsk && String(classroom.course.hskLevel) !== selectedHsk) continue;
      const teacherId = classroom.teacher?.id ?? "unassigned";
      const teacherName = classroom.teacher?.name ?? "Chưa phân công";
      const current = counts.get(teacherId) ?? { id: teacherId, name: teacherName, count: 0 };
      current.count += 1;
      counts.set(teacherId, current);
    }
    return Array.from(counts.values())
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, "vi"));
  }, [classes, selectedHsk]);
  const hasActiveFilters = Boolean(query.trim() || selectedHsk || selectedTeacher);
  function changeSelectedHsk(nextHsk: string) {
    setSelectedHsk(nextHsk);
    if (selectedTeacher && !classes.some((classroom) => (
      (!nextHsk || String(classroom.course.hskLevel) === nextHsk)
      && (classroom.teacher?.id ?? "unassigned") === selectedTeacher
    ))) {
      setSelectedTeacher("");
    }
  }

  const filteredClasses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("vi");
    return classes.filter((classroom) => {
      const matchesHsk = !selectedHsk || String(classroom.course.hskLevel) === selectedHsk;
      const matchesTeacher = !selectedTeacher || (classroom.teacher?.id ?? "unassigned") === selectedTeacher;
      const searchText = `${classroom.name} ${classroom.course.code} ${classroom.course.title} ${classroom.teacher?.name ?? ""}`.toLocaleLowerCase("vi");
      return matchesHsk && matchesTeacher && (!normalizedQuery || searchText.includes(normalizedQuery));
    });
  }, [classes, query, selectedHsk, selectedTeacher]);
  const selectedRecordClass = classes.find(({ id }) => id === selectedRecordClassId) ?? null;

  useEffect(() => {
    if (!selectedRecordClassId) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedRecordClassId(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedRecordClassId]);

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Tổng quan lớp học</h1>
            <p className="mt-1 text-sm text-muted-foreground">Theo dõi lớp đang học, giáo viên và video từng buổi.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/admin/teachers" className="text-sm font-medium text-primary hover:underline">Phân công giáo viên</Link>
            <Button asChild variant="outline">
              <Link to="/admin/classes">Quản lý lớp</Link>
            </Button>
          </div>
        </header>

        <section aria-labelledby="class-count-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="class-count-heading" className="text-base font-semibold">Lớp đang học theo HSK</h2>
            <span className="text-sm text-muted-foreground">{classes.length} lớp đang mở</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {hskCounts.map(({ hskLevel, count }) => (
              <button
                key={hskLevel}
                type="button"
                onClick={() => changeSelectedHsk(selectedHsk === String(hskLevel) ? "" : String(hskLevel))}
                aria-pressed={selectedHsk === String(hskLevel)}
                className={`flex min-h-16 items-center justify-between rounded-lg border px-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  selectedHsk === String(hskLevel) ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"
                }`}
              >
                <span className="text-sm font-medium">HSK {hskLevel}</span>
                <span className="text-xl font-semibold tabular-nums">{count}<span className="ml-1 text-xs font-normal text-muted-foreground">lớp</span></span>
              </button>
            ))}
          </div>
        </section>

        <section aria-labelledby="active-classes-heading" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 id="active-classes-heading" className="text-base font-semibold">Lớp đang học</h2>
              <p className="mt-1 text-sm text-muted-foreground">Video chỉ hiển thị với học viên thuộc lớp đó.</p>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
              <label className="relative sm:w-64">
                <span className="sr-only">Tìm lớp, khóa học hoặc giáo viên</span>
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Tìm lớp, giáo viên..." className="pl-9" />
              </label>
              <label>
                <span className="sr-only">Lọc theo HSK</span>
                <select
                  value={selectedHsk}
                  onChange={(event) => changeSelectedHsk(event.currentTarget.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-32"
                >
                  <option value="">Tất cả HSK</option>
                  {[...new Set(classes.map(({ course }) => course.hskLevel))].sort().map((hsk) => (
                    <option key={hsk} value={hsk}>HSK {hsk}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="sr-only">Lọc theo giáo viên</span>
                <select
                  value={selectedTeacher}
                  onChange={(event) => setSelectedTeacher(event.currentTarget.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-52"
                >
                  <option value="">Tất cả giáo viên</option>
                  {teacherCounts.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name} ({teacher.count} lớp)
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground" aria-live="polite">
            <span>{filteredClasses.length} / {classes.length} lớp</span>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSelectedHsk("");
                  setSelectedTeacher("");
                }}
                className="font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Xóa bộ lọc
              </button>
            )}
          </div>

          {filteredClasses.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {classes.length === 0 ? "Chưa có lớp đang học." : "Không có lớp nào khớp bộ lọc."}
            </p>
          ) : (
            <div className="divide-y rounded-lg border bg-card">
              {filteredClasses.map((classroom) => {
                const lessonVideoById = new Map<string, string>();
                for (const session of classroom.attendanceSessions) {
                  const recordUrl = getSafeRecordUrl(session.recordingUrl);
                  if (session.lessonId && recordUrl && !lessonVideoById.has(session.lessonId)) {
                    lessonVideoById.set(session.lessonId, recordUrl);
                  }
                }
                const linkedLessonCount = classroom.course.lessons.filter(({ id }) => lessonVideoById.has(id)).length;
                const scoresByStudent = new Map(classroom.studentScores.map(({ studentId, score }) => [studentId, score]));
                const studentsRegisteredForHigherHsk = new Set(
                  classroom.enrollments
                    .filter(({ user: student }) => student.enrollments.some(
                      ({ course }) => course.hskLevel > classroom.course.hskLevel,
                    ))
                    .map(({ user: student }) => student.id),
                );
                const hasFinalScores = scoresByStudent.size > 0;
                const hasHigherHskRegistrations = studentsRegisteredForHigherHsk.size > 0;
                const trackedSessions = classroom.attendanceSessions.filter(
                  (session) => session.records.some(({ status }) => status !== null),
                );
                const latestSession = trackedSessions[0] ?? classroom.attendanceSessions[0] ?? null;
                return (
                  <details key={classroom.id} className="group">
                    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 p-4 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:p-5 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{classroom.name}</h3>
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">HSK {classroom.course.hskLevel}</span>
                          <span className="text-xs text-muted-foreground">{classroom.course.code}</span>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">Đang học</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {formatSchedule(classroom.schedule)} · {classroom.teacher?.name ?? "Chưa phân công"}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="text-right text-sm tabular-nums">
                          <span className="block font-semibold">{classroom._count.enrollments}/{classroom.maxStudents}</span>
                          <span className="text-xs text-muted-foreground">học viên</span>
                        </span>
                        <span className="text-right text-sm tabular-nums">
                          <span className="block font-semibold">{trackedSessions.length}</span>
                          <span className="text-xs text-muted-foreground">buổi đã điểm danh</span>
                        </span>
                        <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                      </div>
                    </summary>

                    <div className="space-y-4 border-t px-4 py-4 sm:px-5">
                      {latestSession ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3">
                          <div>
                            <p className="font-medium">Buổi gần nhất: {latestSession.title}</p>
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {latestSession.date.toLocaleDateString("vi-VN")} · {latestSession.records.filter(({ status }) => status !== null).length}/{classroom.enrollments.length} học viên đã điểm danh
                            </p>
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSelectedRecordClassId(classroom.id)}
                            disabled={classroom.course.lessons.length === 0}
                            aria-label={`Xem video bài học của lớp ${classroom.name}`}
                            className="shrink-0"
                          >
                            <Video aria-hidden="true" className="mr-2 h-4 w-4" />
                            Video bài học
                            <span className="ml-2 text-xs text-muted-foreground">{linkedLessonCount}/{classroom.course.lessons.length}</span>
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-4 py-3">
                          <p className="text-sm text-muted-foreground">Lớp chưa có buổi điểm danh.</p>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setSelectedRecordClassId(classroom.id)}
                            disabled={classroom.course.lessons.length === 0}
                            aria-label={`Xem video bài học của lớp ${classroom.name}`}
                          >
                            <Video aria-hidden="true" className="mr-2 h-4 w-4" />
                            Video bài học
                            <span className="ml-2 text-xs text-muted-foreground">{linkedLessonCount}/{classroom.course.lessons.length}</span>
                          </Button>
                        </div>
                      )}

                      <div>
                        <h4 className="mb-2 text-sm font-semibold">Danh sách học viên</h4>
                        {classroom.enrollments.length === 0 ? (
                          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">Lớp chưa có học viên.</p>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border">
                            <table className={`w-full border-collapse text-left ${hasFinalScores && hasHigherHskRegistrations ? "min-w-[760px]" : hasFinalScores || hasHigherHskRegistrations ? "min-w-[650px]" : "min-w-[560px]"}`}>
                              <caption className="sr-only">Thông tin học viên lớp {classroom.name}</caption>
                              <thead className="bg-muted/40">
                                <tr className="border-b">
                                  <th scope="col" className="w-12 px-3 py-2.5 text-xs font-semibold text-muted-foreground">STT</th>
                                  <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                                  <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Vắng / tổng buổi</th>
                                  {hasFinalScores && <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Điểm cuối khóa</th>}
                                  {hasHigherHskRegistrations && <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Đăng ký khóa sau</th>}
                                  <th scope="col" className="px-3 py-2.5 text-xs font-semibold text-muted-foreground">Trạng thái</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y">
                                {classroom.enrollments.map(({ user: student }, index) => {
                                  const absentCount = trackedSessions.reduce((count, session) => (
                                    count + (session.records.find(({ studentId }) => studentId === student.id)?.status === "ABSENT" ? 1 : 0)
                                  ), 0);
                                  const isRegisteredForHigherHsk = studentsRegisteredForHigherHsk.has(student.id);
                                  const status = !student.isActive
                                    ? { label: "Đã khóa", className: "bg-muted text-muted-foreground" }
                                    : !student.isActivated
                                      ? { label: "Chưa kích hoạt", className: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200" }
                                      : { label: "Đang học", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" };
                                  return (
                                    <tr key={student.id}>
                                      <td className="px-3 py-2.5 text-sm tabular-nums text-muted-foreground">{index + 1}</td>
                                      <th scope="row" className="px-3 py-2.5 text-sm font-medium">{student.name}</th>
                                      <td className="px-3 py-2.5 text-sm tabular-nums">{absentCount}/{trackedSessions.length} buổi</td>
                                      {hasFinalScores && (
                                        <td className="px-3 py-2.5 text-sm tabular-nums">
                                          {scoresByStudent.has(student.id) ? `${scoresByStudent.get(student.id)}/10` : "—"}
                                        </td>
                                      )}
                                      {hasHigherHskRegistrations && (
                                        <td className="px-3 py-2.5 text-sm">
                                          <span className="inline-flex items-center gap-1.5">
                                            {isRegisteredForHigherHsk
                                              ? <CheckCircle2 aria-hidden="true" className="h-4 w-4 text-emerald-700" />
                                              : <Circle aria-hidden="true" className="h-4 w-4 text-muted-foreground" />}
                                            {isRegisteredForHigherHsk ? "Rồi" : "Chưa"}
                                          </span>
                                        </td>
                                      )}
                                      <td className="px-3 py-2.5 text-sm">
                                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${status.className}`}>{status.label}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>

        <section aria-labelledby="completed-classes-heading" className="space-y-4">
          <div>
            <h2 id="completed-classes-heading" className="text-base font-semibold">Kết quả cuối khóa</h2>
            <p className="mt-1 text-sm text-muted-foreground">Chỉ xem điểm, chuyên cần, nhận xét và lựa chọn của giáo viên.</p>
          </div>
          {completedClassesWithResults.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-sm text-muted-foreground">Chưa có lớp nào kết thúc với kết quả cuối khóa.</p>
          ) : (
            <div className="space-y-4">
              {completedClassesWithResults.map((classroom) => (
                <article key={classroom.id} className="overflow-hidden rounded-lg border bg-card">
                  <header className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
                    <div className="space-x-2">
                      <span className="font-semibold">{classroom.name}</span>
                      <span className="text-sm text-muted-foreground">HSK {classroom.course.hskLevel} · {classroom.course.code}</span>
                      {classroom.teacher && <span className="text-sm text-muted-foreground">· {classroom.teacher.name}</span>}
                    </div>
                    <time className="text-xs text-muted-foreground">{classroom.completedAt?.toLocaleDateString("vi-VN")}</time>
                  </header>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] border-collapse text-left">
                      <thead className="bg-muted/40">
                        <tr className="border-b">
                          <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Học viên</th>
                          <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Điểm</th>
                          <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Chuyên cần</th>
                          <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Kết quả</th>
                          <th scope="col" className="px-4 py-2.5 text-xs font-semibold text-muted-foreground">Nhận xét</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {classroom.finalResults.map((result) => (
                          <tr key={result.student.id}>
                            <th scope="row" className="px-4 py-3 text-sm font-medium">{result.student.name}</th>
                            <td className="px-4 py-3 text-sm tabular-nums">{result.score}/10</td>
                            <td className="px-4 py-3 text-sm tabular-nums">
                              {result.totalSessions > 0 ? Math.round((result.attendedSessions / result.totalSessions) * 100) : 0}%
                              <span className="ml-1 text-xs text-muted-foreground">({result.attendedSessions}/{result.totalSessions})</span>
                            </td>
                            <td className="px-4 py-3 text-sm">{result.decision === "PROMOTE" ? "Lên lớp" : "Ở lại"}</td>
                            <td className="max-w-md whitespace-pre-wrap px-4 py-3 text-sm text-muted-foreground">{result.comment}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
      {selectedRecordClass && (
        <Overlay onClose={() => setSelectedRecordClassId(null)} className="max-w-2xl">
          <section role="dialog" aria-modal="true" aria-labelledby="lesson-video-dialog-title" className="space-y-4">
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id="lesson-video-dialog-title" className="text-lg font-semibold">Video bài học</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedRecordClass.name} · {selectedRecordClass.course.title}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setSelectedRecordClassId(null)}
                aria-label="Đóng danh sách video bài học"
                className="shrink-0"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </header>
            <div className="max-h-[60vh] overflow-y-auto rounded-lg border">
              {selectedRecordClass.course.lessons.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-muted-foreground">Khóa học chưa có bài học.</p>
              ) : (
                <ul className="divide-y">
                  {selectedRecordClass.course.lessons.map((lesson) => {
                    const linkedSession = selectedRecordClass.attendanceSessions.find(
                      (session) => session.lessonId === lesson.id && getSafeRecordUrl(session.recordingUrl),
                    );
                    const recordUrl = getSafeRecordUrl(linkedSession?.recordingUrl ?? null);
                    return (
                      <li key={lesson.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">Bài {lesson.order} · {lesson.title}</p>
                          {linkedSession && (
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {linkedSession.title} · {linkedSession.date.toLocaleDateString("vi-VN")}
                            </p>
                          )}
                        </div>
                        {recordUrl ? (
                          <a
                            href={recordUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Mở video<ArrowUpRight aria-hidden="true" className="h-4 w-4" />
                          </a>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                            <Circle aria-hidden="true" className="h-3.5 w-3.5" />
                            Chưa có link
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex justify-end border-t pt-3">
              <Button type="button" variant="outline" onClick={() => setSelectedRecordClassId(null)}>Đóng</Button>
            </div>
          </section>
        </Overlay>
      )}
    </AppShell>
  );
}
