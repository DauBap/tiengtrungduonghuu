import { useEffect, useMemo, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { toast } from "sonner";
import { ArrowLeft, Send } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Prisma } from "@prisma/client";
import { formatAudioScript, formatGrammarQuestions, getCorrectionTargetFields, isContentCorrectionTargetType, parseCorrectionProposal, serializeCorrectionData, type ContentCorrectionTarget } from "~/lib/content-corrections";
import { listCourseCorrectionTargets } from "~/lib/content-corrections.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import { WORD_TYPE_META, isWordType } from "~/lib/word-types";
import { WordTypeMultiSelect } from "~/components/ui/word-type-multi-select";
import { AudioScriptCorrectionEditor } from "~/components/ui/audio-script-correction-editor";
import { GrammarQuestionsCorrectionEditor } from "~/components/ui/grammar-questions-correction-editor";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toInputValue(value: unknown) {
  if (Array.isArray(value)) return value.join("\n");
  if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
  return value == null ? "" : String(value);
}

function toDisplayValue(value: unknown) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((item) => isWordType(item) ? WORD_TYPE_META[item].label : String(item)).join(", ");
  }
  if (typeof value === "object" && value !== null) return JSON.stringify(value, null, 2);
  if (typeof value === "boolean") return value ? "Có" : "Không";
  return value == null || value === "" ? "—" : String(value);
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function getFieldLabel(field: string) {
  const labels: Record<string, string> = {
    chinese: "Tiếng Trung",
    chineseAlternatives: "Cách viết tiếng Trung khác (mỗi dòng một cách)",
    pinyin: "Pinyin",
    pinyinAlternatives: "Pinyin khác (mỗi dòng một cách)",
    translation: "Nghĩa tiếng Việt",
    translationAlternatives: "Nghĩa khác (mỗi dòng một nghĩa)",
    wordTypes: "Từ loại",
    speakers: "Toàn bộ script",
    questions: "Câu hỏi luyện tập",
    note: "Ghi chú",
    prompt: "Nội dung câu hỏi",
    options: "Các lựa chọn (mỗi dòng một lựa chọn)",
    answer: "Đáp án",
    acceptedAnswers: "Các đáp án được chấp nhận (mỗi dòng một đáp án)",
    hint: "Giải thích / gợi ý",
    title: "Tiêu đề",
    explanation: "Giải thích",
    formula: "Công thức",
    examples: "Ví dụ",
    given: "Nội dung cho trước",
    syllable: "Âm tiết",
    answerTone: "Thanh điệu đáp án (1–5)",
    full: "Đáp án đầy đủ",
    audioText: "Nội dung đọc",
    description: "Mô tả",
    sampleAnswer: "Đáp án mẫu",
    payload: "Dữ liệu câu hỏi (JSON)",
    content: "Nội dung lựa chọn",
    isCorrect: "Đây là đáp án đúng",
    imageUrl: "Đường dẫn hình ảnh",
    audioUrl: "Đường dẫn âm thanh",
    points: "Điểm câu hỏi",
  };
  return labels[field] ?? field;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const url = new URL(request.url);
  const selectedCourseId = url.searchParams.get("courseId") ?? "";
  const selectedLessonId = url.searchParams.get("lessonId") ?? "";
  const courses = await prisma.course.findMany({
    where: { classes: { some: { teacherId: user.id } } },
    orderBy: [{ hskLevel: "asc" }, { order: "asc" }],
    select: {
      id: true,
      title: true,
      hskLevel: true,
      lessons: { orderBy: { order: "asc" }, select: { id: true, title: true, order: true } },
    },
  });
  const selectedCourse = courses.find(({ id }) => id === selectedCourseId) ?? null;
  const selectedLesson = selectedCourse?.lessons.find(({ id }) => id === selectedLessonId) ?? null;
  const courseTargets = selectedCourse
    ? (await prisma.$transaction((tx) => listCourseCorrectionTargets(tx, selectedCourse.id))) ?? []
    : [];
  const targets = selectedLesson
    ? courseTargets.filter((target) => target.lessonId === selectedLesson.id)
    : courseTargets;
  const selectableTargets = targets.filter((target) => target.type !== "AUDIO_SPEAKER" && target.type !== "GRAMMAR_QUESTION");
  const history = await prisma.contentCorrection.findMany({
    where: { teacherId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      targetLabel: true,
      courseTitle: true,
      lessonTitle: true,
      reason: true,
      reviewNote: true,
      status: true,
      createdAt: true,
      reviewedAt: true,
    },
  });
  return { user, courses, selectedCourseId: selectedCourse?.id ?? "", selectedLessonId: selectedLesson?.id ?? "", targets: selectableTargets, history };
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["teacher"]);
  const form = await request.formData();
  const targetType = String(form.get("targetType") ?? "");
  const targetId = String(form.get("targetId") ?? "");
  const courseId = String(form.get("courseId") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!isContentCorrectionTargetType(targetType) || !targetId || !courseId) {
    return { success: false as const, error: "Vui lòng chọn nội dung cần góp ý." };
  }
  if (reason.length < 5 || reason.length > 2000) {
    return { success: false as const, error: "Lý do góp ý cần có ít nhất 5 và không quá 2.000 ký tự." };
  }

  const course = await prisma.course.findFirst({
    where: { id: courseId, classes: { some: { teacherId: user.id } } },
    select: { id: true, title: true },
  });
  if (!course) return { success: false as const, error: "Khóa học không tồn tại hoặc bạn không được phân công dạy khóa này." };

  const targets = await prisma.$transaction((tx) => listCourseCorrectionTargets(tx, course.id));
  const target = targets?.find((item) => item.type === targetType && item.id === targetId);
  if (!target) return { success: false as const, error: "Nội dung không thuộc khóa học đã chọn. Hãy tải lại trang." };

  let parsedData: unknown;
  try {
    parsedData = JSON.parse(String(form.get("proposedData") ?? ""));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return { success: false as const, error: "Nội dung đề xuất không hợp lệ. Hãy kiểm tra lại các trường đã sửa." };
    }
    throw error;
  }
  const proposedData = parseCorrectionProposal(target.type, target.data, parsedData);
  if (!proposedData) {
    return { success: false as const, error: "Vui lòng nhập thay đổi hợp lệ khác với nội dung hiện tại." };
  }

  const admins = await prisma.user.findMany({
    where: { role: "admin", isActive: true, isActivated: true, deletedAt: null },
    select: { id: true },
  });
  if (admins.length === 0) return { success: false as const, error: "Hiện chưa có quản trị viên nhận góp ý. Vui lòng thử lại sau." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const currentTargets = await listCourseCorrectionTargets(tx, course.id);
      const currentTarget = currentTargets?.find((item) => item.type === targetType && item.id === targetId);
      if (!currentTarget || serializeCorrectionData(currentTarget.data) !== serializeCorrectionData(target.data)) {
        return { success: false as const, error: "Nội dung vừa thay đổi. Hãy tải lại trang và tạo góp ý mới." };
      }
      const hasPending = await tx.contentCorrection.findFirst({
        where: { targetType, targetId, status: "PENDING" },
        select: { id: true },
      });
      if (hasPending) {
        return { success: false as const, error: "Đã có góp ý đang chờ duyệt cho nội dung này." };
      }
      const created = await tx.contentCorrection.create({
        data: {
          teacherId: user.id,
          targetType,
          targetId,
          targetLabel: target.label,
          courseId: course.id,
          courseTitle: course.title,
          lessonId: target.lessonId,
          lessonTitle: target.lessonTitle,
          originalData: toInputJson(target.data),
          proposedData: toInputJson(proposedData),
          reason,
        },
        select: { id: true },
      });
      await tx.userNotification.createMany({
        data: admins.map(({ id }) => ({
          recipientId: id,
          actorId: user.id,
          kind: "CONTENT_CORRECTION_SUBMITTED",
          title: "Có góp ý chỉnh sửa nội dung",
          message: `${user.name} đề xuất chỉnh sửa “${target.label}” trong ${course.title}.`,
          targetUrl: "/admin/content-corrections",
          entityId: created.id,
        })),
      });
      return { success: true as const, correctionId: created.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return { success: false as const, error: "Góp ý vừa được gửi cho nội dung này. Hãy tải lại trang." };
    }
    throw error;
  }
}

export default function TeacherContentCorrections() {
  const { user, courses, selectedCourseId, selectedLessonId, targets, history } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const [selectedTargetKey, setSelectedTargetKey] = useState("");
  const selectedTarget = useMemo<ContentCorrectionTarget | null>(() => {
    const separator = selectedTargetKey.indexOf(":");
    if (separator < 0) return null;
    const type = selectedTargetKey.slice(0, separator);
    const id = selectedTargetKey.slice(separator + 1);
    return targets.find((target) => target.type === type && target.id === id) ?? null;
  }, [selectedTargetKey, targets]);

  useEffect(() => {
    if (!selectedTargetKey && targets.length > 0) {
      setSelectedTargetKey(`${targets[0].type}:${targets[0].id}`);
    } else if (selectedTargetKey && !selectedTarget) {
      setSelectedTargetKey("");
    }
  }, [selectedTargetKey, selectedTarget, targets]);

  useEffect(() => {
    if (!fetcher.data) return;
    if (fetcher.data.success) {
      toast.success("Đã gửi góp ý cho quản trị viên duyệt.");
      return;
    }
    toast.error(fetcher.data.error);
  }, [fetcher.data]);

  function submitCorrection(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTarget) return;
    const formData = new FormData(event.currentTarget);
    const proposedData: Record<string, unknown> = {};
    for (const field of getCorrectionTargetFields(selectedTarget.type)) {
      const currentValue = selectedTarget.data[field];
      const value = String(formData.get(`field_${field}`) ?? "");
      if (field === "speakers" || field === "questions") {
        try {
          proposedData[field] = JSON.parse(value);
        } catch {
          toast.error(`Trường “${getFieldLabel(field)}” cần đúng định dạng.`);
          return;
        }
      } else if (field === "wordTypes") {
        proposedData[field] = formData.getAll(`field_${field}`).filter(isWordType);
      } else if (Array.isArray(currentValue)) {
        proposedData[field] = value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      } else if (typeof currentValue === "boolean") {
        proposedData[field] = value === "true";
      } else if (typeof currentValue === "number") {
        proposedData[field] = value.trim() === "" ? Number.NaN : Number(value);
      } else if (typeof currentValue === "object" && currentValue !== null) {
        try {
          proposedData[field] = JSON.parse(value);
        } catch {
          toast.error(`Trường “${getFieldLabel(field)}” cần là JSON hợp lệ.`);
          return;
        }
      } else if (currentValue === null && value.trim() === "") {
        proposedData[field] = null;
      } else {
        proposedData[field] = value;
      }
    }
    fetcher.submit({
      intent: "submit-correction",
      courseId: selectedCourseId,
      targetType: selectedTarget.type,
      targetId: selectedTarget.id,
      reason: String(formData.get("reason") ?? ""),
      proposedData: JSON.stringify(proposedData),
    }, { method: "post" });
  }

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <Link to={selectedCourseId ? `/teacher/courses/${selectedCourseId}` : "/teacher/courses"} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            Khóa học của tôi
          </Link>
          <h1 className="text-2xl font-bold tracking-tight">Góp ý chỉnh sửa nội dung</h1>
          <p className="text-sm text-muted-foreground">
            Đề xuất chỉ cập nhật nội dung dùng chung sau khi được duyệt. Với đề thi chính thức, bản đang thi và kết quả cũ được giữ nguyên.
          </p>
        </header>

        <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-6">
          <form method="get" className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5 text-sm font-medium">
              Khóa học
              <select
                name="courseId"
                defaultValue={selectedCourseId}
                onChange={(event) => {
                  const form = event.currentTarget.form;
                  if (form) form.requestSubmit();
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <option value="">Chọn khóa học</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>HSK {course.hskLevel} · {course.title}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              Lọc theo bài học (không bắt buộc)
              <select
                name="lessonId"
                defaultValue={selectedLessonId}
                disabled={!selectedCourseId}
                onChange={(event) => {
                  const form = event.currentTarget.form;
                  if (form) form.requestSubmit();
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">Chọn bài học</option>
                {courses.find(({ id }) => id === selectedCourseId)?.lessons.map((lesson) => (
                  <option key={lesson.id} value={lesson.id}>Bài {lesson.order} · {lesson.title}</option>
                ))}
              </select>
            </label>
          </form>

          {!selectedCourseId ? (
            <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Chọn khóa học để xem nội dung có thể góp ý.
            </p>
          ) : targets.length === 0 ? (
            <p className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Khóa học này chưa có nội dung hỗ trợ góp ý.
            </p>
          ) : (
            <form onSubmit={submitCorrection} className="space-y-4 border-t pt-4">
              <label className="block space-y-1.5 text-sm font-medium">
                Nội dung cần chỉnh sửa
                <select
                  value={selectedTargetKey}
                  onChange={(event) => setSelectedTargetKey(event.currentTarget.value)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {targets.map((target) => (
                    <option key={`${target.type}:${target.id}`} value={`${target.type}:${target.id}`}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
              {selectedTarget && (
                <div className="rounded-md border">
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th scope="col" className="w-[24%] px-3 py-2.5 font-semibold">Trường dữ liệu</th>
                        <th scope="col" className="w-[34%] px-3 py-2.5 font-semibold">Hiện tại</th>
                        <th scope="col" className="w-[42%] px-3 py-2.5 font-semibold">Góp ý</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                  {getCorrectionTargetFields(selectedTarget.type).map((field) => {
                    const value = selectedTarget.data[field];
                    return (
                      <tr key={field} className="align-top">
                        <th scope="row" className="px-3 py-3 font-medium">{getFieldLabel(field)}</th>
                        <td className="px-3 py-3">
                          <div className="min-h-10 whitespace-pre-wrap break-words rounded-md bg-muted/40 px-3 py-2 text-sm font-normal text-muted-foreground">
                            {selectedTarget.type === "AUDIO_SCRIPT" && field === "speakers"
                              ? formatAudioScript(value)
                              : selectedTarget.type === "GRAMMAR_SECTION" && field === "questions"
                                ? formatGrammarQuestions(value)
                                : toDisplayValue(value)}
                          </div>
                        </td>
                        <td className="px-3 py-3">
                        {field === "speakers" ? (
                          <AudioScriptCorrectionEditor key={selectedTarget.id} name={`field_${field}`} value={value} />
                        ) : field === "questions" && selectedTarget.type === "GRAMMAR_SECTION" ? (
                          <GrammarQuestionsCorrectionEditor name={`field_${field}`} value={value} />
                        ) : field === "wordTypes" ? (
                          <WordTypeMultiSelect name={`field_${field}`} value={value} />
                        ) : typeof value === "boolean" ? (
                          <select
                            name={`field_${field}`}
                            defaultValue={String(value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value="true">Có</option>
                            <option value="false">Không</option>
                          </select>
                        ) : Array.isArray(value) || (typeof value === "object" && value !== null) ? (
                          <textarea
                            name={`field_${field}`}
                            defaultValue={toInputValue(value)}
                            rows={Array.isArray(value) ? Math.min(5, Math.max(2, value.length + 1)) : 5}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        ) : (
                          <input
                            name={`field_${field}`}
                            type={typeof value === "number" ? "number" : "text"}
                            min={field === "answerTone" ? 1 : undefined}
                            max={field === "answerTone" ? 5 : undefined}
                            step={field === "points" ? "0.1" : undefined}
                            defaultValue={toInputValue(value)}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          />
                        )}
                        </td>
                      </tr>
                    );
                  })}
                    </tbody>
                  </table>
                </div>
              )}
              <label className="block space-y-1.5 text-sm font-medium">
                Lý do đề xuất
                <textarea
                  name="reason"
                  required
                  minLength={5}
                  maxLength={2000}
                  rows={3}
                  placeholder="Mô tả ngắn gọn chỗ chưa chính xác và căn cứ chỉnh sửa..."
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="submit" disabled={!selectedTarget || fetcher.state !== "idle"} className="gap-2">
                  <Send aria-hidden="true" className="h-4 w-4" />
                  {fetcher.state !== "idle" ? "Đang gửi..." : "Gửi quản trị viên duyệt"}
                </Button>
              </div>
              {fetcher.data && !fetcher.data.success && (
                <p role="alert" className="text-sm text-destructive">{fetcher.data.error}</p>
              )}
            </form>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">Góp ý của tôi</h2>
            <span className="text-sm text-muted-foreground">20 góp ý gần nhất</span>
          </div>
          {history.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Bạn chưa gửi góp ý chỉnh sửa nào.
            </p>
          ) : (
            <div className="divide-y rounded-lg border bg-card">
              {history.map((item) => (
                <article key={item.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-medium">{item.targetLabel}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      item.status === "APPROVED" ? "bg-emerald-100 text-emerald-800"
                        : item.status === "REJECTED" ? "bg-destructive/10 text-destructive"
                          : "bg-amber-100 text-amber-900"
                    }`}>
                      {item.status === "APPROVED" ? "Đã duyệt" : item.status === "REJECTED" ? "Chưa được duyệt" : "Đang chờ duyệt"}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {[item.courseTitle, item.lessonTitle].filter(Boolean).join(" · ")} · {item.createdAt.toLocaleDateString("vi-VN")}
                  </p>
                  <p className="whitespace-pre-wrap text-sm">{item.reason}</p>
                  {item.reviewNote && (
                    <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                      Phản hồi quản trị viên: {item.reviewNote}
                    </p>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
