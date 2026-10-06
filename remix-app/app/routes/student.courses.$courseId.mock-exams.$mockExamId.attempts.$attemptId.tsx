import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Link, useFetcher, useLoaderData } from "react-router";
import { ArrowLeft, Check, Clock3, Send } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { ProgressBar } from "~/components/progress/progress-bar";
import { isEnrolled } from "~/lib/db.server";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";
import type { Prisma } from "@prisma/client";

interface SnapshotOption {
  id: string;
  content: string;
  imageUrl: string | null;
  isCorrect?: boolean;
}
interface SnapshotQuestion {
  id: string;
  type: string;
  prompt: string;
  imageUrl: string | null;
  audioUrl: string | null;
  points: number;
  options: SnapshotOption[];
}
interface SnapshotSection {
  id: string;
  title: string;
  description: string | null;
  questions: SnapshotQuestion[];
}

function readSnapshot(raw: Prisma.JsonValue): SnapshotSection[] {
  if (!Array.isArray(raw)) throw new Response("Dữ liệu đề thi không hợp lệ", { status: 500 });
  return raw.map((rawSection) => {
    if (!rawSection || typeof rawSection !== "object" || Array.isArray(rawSection)) {
      throw new Response("Dữ liệu phần thi không hợp lệ", { status: 500 });
    }
    const section = rawSection as Record<string, unknown>;
    const questionList = section.questions;
    if (!Array.isArray(questionList)) throw new Response("Dữ liệu câu hỏi không hợp lệ", { status: 500 });
    return {
      id: String(section.id ?? ""),
      title: String(section.title ?? ""),
      description: typeof section.description === "string" ? section.description : null,
      questions: questionList.map((rawQuestion: unknown) => {
        if (!rawQuestion || typeof rawQuestion !== "object") throw new Response("Dữ liệu câu hỏi không hợp lệ", { status: 500 });
        const question = rawQuestion as Record<string, unknown>;
        if (!Array.isArray(question.options)) throw new Response("Dữ liệu lựa chọn không hợp lệ", { status: 500 });
        return {
          id: String(question.id ?? ""),
          type: String(question.type ?? "SINGLE_CHOICE"),
          prompt: String(question.prompt ?? ""),
          imageUrl: typeof question.imageUrl === "string" ? question.imageUrl : null,
          audioUrl: typeof question.audioUrl === "string" ? question.audioUrl : null,
          points: Number(question.points) || 0,
          options: question.options.map((rawOption) => {
            if (!rawOption || typeof rawOption !== "object") throw new Response("Dữ liệu lựa chọn không hợp lệ", { status: 500 });
            const option = rawOption as Record<string, unknown>;
            return {
              id: String(option.id ?? ""),
              content: String(option.content ?? ""),
              imageUrl: typeof option.imageUrl === "string" ? option.imageUrl : null,
              isCorrect: option.isCorrect === true,
            };
          }),
        };
      }),
    };
  });
}

function parseAnswers(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {} as Record<string, string[]>;
  const answers: Record<string, string[]> = {};
  for (const [questionId, value] of Object.entries(raw)) {
    if (Array.isArray(value)) answers[questionId] = value.filter((item): item is string => typeof item === "string");
  }
  return answers;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId!;
  if (!(await isEnrolled(user.id, courseId))) throw new Response("Bạn không thuộc khóa học này", { status: 403 });
  const [course, attempt] = await Promise.all([
    prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, hskLevel: true } }),
    prisma.mockExamAttempt.findFirst({
      where: {
        id: params.attemptId!,
        userId: user.id,
        mockExamId: params.mockExamId!,
        mockExam: { courseId },
      },
      include: {
        mockExam: { select: { id: true, title: true, passScore: true, showAnswers: true } },
      },
    }),
  ]);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });
  if (!attempt) throw new Response("Không tìm thấy lượt làm bài", { status: 404 });
  const rawSections = readSnapshot(attempt.questionSnapshot);
  const reveal = attempt.status === "SUBMITTED" && attempt.mockExam.showAnswers;
  const sections = rawSections.map((section) => ({
    ...section,
    questions: section.questions.map((question) => ({
      ...question,
      options: question.options.map(({ isCorrect, ...option }) =>
        reveal ? { ...option, isCorrect } : option
      ),
    })),
  }));
  return {
    user,
    course,
    exam: { id: attempt.mockExam.id, title: attempt.mockExam.title, passScore: attempt.mockExam.passScore },
    attempt: {
      id: attempt.id,
      status: attempt.status,
      attemptNumber: attempt.attemptNumber,
      expiresAt: attempt.expiresAt?.toISOString() ?? null,
      percentage: attempt.percentage,
      earnedPoints: attempt.earnedPoints,
      totalPoints: attempt.totalPoints,
      passed: attempt.passed,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      answers: parseAnswers(attempt.answers),
    },
    sections,
    revealAnswers: reveal,
  };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const courseId = params.courseId!;
  if (!(await isEnrolled(user.id, courseId))) throw new Response("Bạn không thuộc khóa học này", { status: 403 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const attempt = await prisma.mockExamAttempt.findFirst({
    where: {
      id: params.attemptId!,
      userId: user.id,
      mockExamId: params.mockExamId!,
      mockExam: { courseId },
    },
    include: { mockExam: { select: { passScore: true } } },
  });
  if (!attempt) throw new Response("Không tìm thấy lượt làm bài", { status: 404 });
  if (attempt.status !== "IN_PROGRESS") return { error: "Lượt thi này đã được nộp." };
  const sections = readSnapshot(attempt.questionSnapshot);
  const allQuestions = sections.flatMap((section) => section.questions);
  const byId = new Map(allQuestions.map((question) => [question.id, question]));

  if (intent === "save-answer") {
    if (attempt.expiresAt && attempt.expiresAt <= new Date()) return { error: "Đã hết giờ làm bài." };
    const questionId = String(form.get("questionId") ?? "");
    const question = byId.get(questionId);
    if (!question) return { error: "Câu hỏi không thuộc lượt thi này." };
    let selectedOptionIds: unknown;
    try {
      selectedOptionIds = JSON.parse(String(form.get("optionIds") ?? "[]"));
    } catch {
      return { error: "Câu trả lời không hợp lệ." };
    }
    if (!Array.isArray(selectedOptionIds) || selectedOptionIds.some((id) => typeof id !== "string")) {
      return { error: "Câu trả lời không hợp lệ." };
    }
    const validIds = new Set(question.options.map((option) => option.id));
    const selected = [...new Set((selectedOptionIds as string[]).filter((id) => validIds.has(id)))];
    const answers = parseAnswers(attempt.answers);
    if (selected.length) answers[questionId] = selected;
    else delete answers[questionId];
    await prisma.mockExamAttempt.update({ where: { id: attempt.id }, data: { answers: answers as Prisma.InputJsonValue } });
    return { saved: true };
  }

  if (intent === "submit") {
    let answers = parseAnswers(attempt.answers);
    const posted = form.get("answers");
    if (typeof posted === "string") {
      try {
        answers = parseAnswers(JSON.parse(posted));
      } catch {
        return { error: "Không thể đọc câu trả lời, vui lòng thử nộp lại." };
      }
    }
    let totalPoints = 0;
    let earnedPoints = 0;
    for (const question of allQuestions) {
      totalPoints += question.points;
      const selected = new Set((answers[question.id] ?? []).filter((id) => question.options.some((option) => option.id === id)));
      const correct = new Set(question.options.filter((option) => option.isCorrect).map((option) => option.id));
      if (correct.size > 0 && selected.size === correct.size && [...selected].every((id) => correct.has(id))) {
        earnedPoints += question.points;
      }
    }
    const percentage = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 10000) / 100 : 0;
    await prisma.mockExamAttempt.update({
      where: { id: attempt.id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        answers: answers as Prisma.InputJsonValue,
        totalPoints,
        earnedPoints,
        percentage,
        passed: percentage >= attempt.mockExam.passScore,
      },
    });
    return { submitted: true };
  }
  return { error: "Thao tác không hợp lệ." };
}

function formatRemaining(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const rest = Math.max(0, seconds) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export default function StudentMockExamAttempt() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const questions = data.sections.flatMap((section) =>
    section.questions.map((question) => ({ ...question, sectionId: section.id })),
  );
  const listeningSections = data.sections.slice(0, 4);
  const readingSections = data.sections.slice(4);
  const [answers, setAnswers] = useState<Record<string, string[]>>(data.attempt.answers);
  const [secondsLeft, setSecondsLeft] = useState(() => data.attempt.expiresAt
    ? Math.max(0, Math.floor((new Date(data.attempt.expiresAt).getTime() - Date.now()) / 1000))
    : 0);
  const [didAutoSubmit, setDidAutoSubmit] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const stickyBarRef = useRef<HTMLDivElement | null>(null);
  const listeningEndRef = useRef<HTMLDivElement | null>(null);
  const [listeningInView, setListeningInView] = useState(true);
  const finished = data.attempt.status === "SUBMITTED";
  const answeredCount = questions.filter((question) => (answers[question.id]?.length ?? 0) > 0).length;
  const unansweredCount = questions.length - answeredCount;
  const progress = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  const listeningAudioUrl = listeningSections.flatMap((section) => section.questions)
    .find((question) => question.audioUrl)?.audioUrl;
  const examTitle = data.exam.title
    .replace(/^HSK\s*\d+\s*-\s*/i, "")
    .replace(/^đề thi thử\s*/i, "ĐỀ ")
    .toLocaleUpperCase("vi");
  const finalSubmit = (nextAnswers = answers) => {
    fetcher.submit({ intent: "submit", answers: JSON.stringify(nextAnswers) }, { method: "post" });
  };

  useEffect(() => {
    if (finished || !data.attempt.expiresAt) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, Math.floor((new Date(data.attempt.expiresAt!).getTime() - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0 && !didAutoSubmit) {
        setDidAutoSubmit(true);
        finalSubmit();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [data.attempt.expiresAt, didAutoSubmit, finished]);

  useEffect(() => {
    const sentinel = listeningEndRef.current;
    if (!sentinel) return;
    const update = () => {
      const progressRow = stickyBarRef.current;
      const threshold = progressRow ? progressRow.getBoundingClientRect().bottom : 0;
      setListeningInView(sentinel.getBoundingClientRect().bottom > threshold);
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [finished, listeningAudioUrl]);

  const toggleOption = (questionId: string, optionId: string, multiple: boolean) => {
    if (finished) return;
    const nextSelected = new Set(answers[questionId] ?? []);
    if (nextSelected.has(optionId)) nextSelected.delete(optionId);
    else {
      if (!multiple) nextSelected.clear();
      nextSelected.add(optionId);
    }
    const next = { ...answers, [questionId]: [...nextSelected] };
    setAnswers(next);
    fetcher.submit({
      intent: "save-answer",
      questionId,
      optionIds: JSON.stringify(next[questionId]),
    }, { method: "post" });
  };

  const renderQuestion = (
    question: SnapshotQuestion,
    index: number,
  ) => {
    const selectedIds = answers[question.id] ?? [];
    const isMultiple = question.type === "MULTIPLE_CHOICE";
    return (
      <fieldset key={question.id} className="space-y-3 border-b border-border/70 pb-5 last:border-0 last:pb-0">
        <legend className="w-full text-base font-semibold">
          <span className="mr-2 inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-primary/10 px-2 text-sm text-primary">
            {index + 1}
          </span>
          Câu {index + 1}
          {question.prompt && <span className="mt-2 block whitespace-pre-line pl-10 font-normal leading-relaxed">{question.prompt}</span>}
        </legend>
        {question.imageUrl && (
          <img
            src={question.imageUrl}
            alt={`Hình minh họa câu ${index + 1}`}
            className="max-h-[28rem] max-w-full rounded-lg border bg-white object-contain"
          />
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {question.options.map((option, optionIndex) => {
            const selected = selectedIds.includes(option.id);
            const correct = "isCorrect" in option && option.isCorrect === true;
            return (
              <button
                key={option.id}
                type="button"
                disabled={finished}
                aria-pressed={selected}
                onClick={() => toggleOption(question.id, option.id, isMultiple)}
                className={`flex min-h-12 items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"
                } ${correct ? "border-green-600 bg-green-50" : ""}`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold">
                  {String.fromCharCode(65 + optionIndex)}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-line">{option.content}</span>
                {correct && <Check className="h-4 w-4 text-green-700" />}
              </button>
            );
          })}
        </div>
        {isMultiple && <p className="text-xs text-muted-foreground">Chọn tất cả đáp án đúng.</p>}
      </fieldset>
    );
  };

  if (finished) {
    return (
      <AppShell user={data.user}>
        <div className="mx-auto max-w-3xl space-y-6">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/student/courses/${data.course.id}/mock-exams`}><ArrowLeft className="mr-1.5 h-4 w-4" />Danh sách bài thi thử</Link>
          </Button>
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">{data.exam.title}</CardTitle>
              <p className="text-sm text-muted-foreground">Kết quả lượt {data.attempt.attemptNumber}</p>
            </CardHeader>
            <CardContent className="space-y-4 text-center">
              <p className="text-5xl font-bold text-primary">{data.attempt.percentage}%</p>
              <p className="font-medium">{data.attempt.passed ? "Chúc mừng, bạn đã đạt!" : "Bạn chưa đạt, hãy ôn tập và thử lại nhé."}</p>
              <p className="text-sm text-muted-foreground">
                {data.attempt.earnedPoints} / {data.attempt.totalPoints} điểm · Điểm đạt {data.exam.passScore}%
              </p>
              <div className="pt-2">
                <Button asChild><Link to={`/student/courses/${data.course.id}/mock-exams/${data.exam.id}`}>Làm lại / xem đề</Link></Button>
              </div>
            </CardContent>
          </Card>
          {data.revealAnswers && data.sections.map((section) => (
            <Card key={section.id}>
              <CardHeader><CardTitle className="text-base">{section.title}</CardTitle></CardHeader>
              <CardContent className="space-y-5">
                {section.questions.map((question, index) => (
                  <div key={question.id} className="space-y-2 border-b pb-4 last:border-0">
                    <p className="font-medium">{index + 1}. {question.prompt}</p>
                    <p className="text-sm text-muted-foreground">
                      Đáp án đúng: {question.options
                        .filter((option) => "isCorrect" in option && option.isCorrect)
                        .map((option) => option.content)
                        .join(", ")}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </AppShell>
    );
  }

  if (!questions.length) return <AppShell user={data.user}><p>Đề thi hiện không có câu hỏi.</p></AppShell>;

  return (
    <AppShell user={data.user}>
      <div className="mx-auto max-w-4xl space-y-5">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/student/courses/${data.course.id}/mock-exams/${data.exam.id}`}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại thông tin đề
          </Link>
        </Button>
        <section className="rounded-xl bg-gradient-to-br from-[#bd382f] to-[#a72d28] px-5 py-8 text-center text-white shadow-sm sm:px-8">
          <p className="text-sm font-semibold tracking-[0.18em] text-white/80">BÀI THI THỬ HSK {data.course.hskLevel}</p>
          <h1 className="mt-2 text-3xl font-bold sm:text-4xl">{examTitle}</h1>
          <p className="mt-3 text-sm text-white/90">
            {questions.length} câu · Phần nghe: {listeningSections.reduce((count, section) => count + section.questions.length, 0)} câu
            {" · "}Phần đọc: {readingSections.reduce((count, section) => count + section.questions.length, 0)} câu
          </p>
          <p className="mt-2 text-sm text-white/90">
            Mỗi câu đúng {questions[0]?.points ?? 1} điểm · Tổng {questions.reduce((total, question) => total + question.points, 0)} điểm
          </p>
          {data.attempt.expiresAt && (
            <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white/15 px-3 py-2 font-mono text-lg">
              <Clock3 className="h-5 w-5" />{formatRemaining(secondsLeft)}
            </div>
          )}
        </section>

        <div className="sticky top-0 z-30 -mx-6 bg-background/95 px-6 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:-mx-8 lg:px-8">
          <Card>
            <CardContent className="space-y-2 p-4 sm:p-5">
              <div ref={stickyBarRef} className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm font-semibold">
                  <span>Đã làm {answeredCount} / {questions.length} câu</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <ProgressBar value={progress} showLabel={false} />
              </div>
              {listeningAudioUrl && (
                <audio
                  controls
                  preload="none"
                  src={listeningAudioUrl}
                  className={listeningInView ? "mt-1 w-full" : "hidden"}
                  aria-label="Âm thanh toàn phần nghe"
                >
                  <track kind="captions" />
                </audio>
              )}
            </CardContent>
          </Card>
        </div>

        {[
          { title: `PHẦN 1: NGHE – ${listeningSections.reduce((count, section) => count + section.questions.length, 0)} câu`, sections: listeningSections },
          { title: `PHẦN 2: ĐỌC – ${readingSections.reduce((count, section) => count + section.questions.length, 0)} câu`, sections: readingSections },
        ].map((part) => part.sections.length > 0 && (
          <Card key={part.title}>
            <CardHeader>
              <CardTitle className="text-xl">{part.title}</CardTitle>
              {part.sections === listeningSections && (
                <>
                  <p className="text-sm text-muted-foreground">Nghe và chọn đáp án. Trình phát âm thanh được ghim ở đầu trang.</p>
                </>
              )}
            </CardHeader>
            <CardContent className="space-y-7">
              {part.sections.map((section) => {
                const sectionQuestions = section.questions;
                const sharedImageUrls = [...new Set(sectionQuestions.flatMap((question) => {
                  const imageUrl = question.imageUrl;
                  return imageUrl && sectionQuestions.filter((item) => item.imageUrl === imageUrl).length > 1
                    ? [imageUrl]
                    : [];
                }))];
                const sectionStart = questions.findIndex((question) => question.sectionId === section.id);
                return (
                  <section key={section.id} className="space-y-4 border-t pt-5 first:border-0 first:pt-0">
                    <h3 className="text-base font-semibold">
                      Câu {sectionStart + 1}–{sectionStart + sectionQuestions.length}: {section.title}
                    </h3>
                    {sharedImageUrls.length > 0 && (
                      <div className="space-y-3">
                        {sharedImageUrls.map((imageUrl) => (
                          <a key={imageUrl} href={imageUrl} target="_blank" rel="noreferrer" className="block">
                            <img src={imageUrl} alt={`Hình đề gốc: ${section.title}`} className="max-h-[34rem] max-w-full rounded-lg border bg-white object-contain" />
                          </a>
                        ))}
                        {sectionQuestions.some((question) => sectionQuestions.filter((item) => item.imageUrl === question.imageUrl).length > 1) && (
                          <p className="text-xs text-muted-foreground">Chạm vào ảnh để xem kích thước đầy đủ.</p>
                        )}
                      </div>
                    )}
                    <div className="space-y-5">
                      {sectionQuestions.map((question, index) => {
                        const sharedImage = question.imageUrl && sharedImageUrls.includes(question.imageUrl);
                        return renderQuestion(sharedImage ? { ...question, imageUrl: null } : question, sectionStart + index);
                      })}
                    </div>
                  </section>
                );
              })}
            </CardContent>
            {part.sections === listeningSections && <div ref={listeningEndRef} aria-hidden />}
          </Card>
        ))}

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
            <p className="text-sm text-muted-foreground">Câu trả lời được lưu tự động.</p>
            <Button type="button" disabled={fetcher.state !== "idle"} onClick={() => setShowSubmitConfirm(true)}>
              <Send className="mr-1.5 h-4 w-4" />Nộp bài
            </Button>
            {fetcher.data?.error && <p role="alert" className="w-full text-sm text-destructive">{fetcher.data.error}</p>}
          </CardContent>
        </Card>

        {showSubmitConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setShowSubmitConfirm(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowSubmitConfirm(false);
            }}
          >
            <section
              role="dialog"
              aria-modal="true"
              aria-labelledby="submit-exam-title"
              aria-describedby="submit-exam-description"
              className="w-full max-w-md overflow-hidden rounded-xl border bg-background shadow-xl"
            >
              <div className="border-b bg-primary/5 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Send className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 id="submit-exam-title" className="text-lg font-semibold">Bạn đã sẵn sàng nộp bài?</h2>
                    <p id="submit-exam-description" className="mt-1 text-sm text-muted-foreground">
                      Sau khi nộp, bạn sẽ không thể thay đổi câu trả lời.
                    </p>
                  </div>
                </div>
              </div>
              <div className="space-y-3 p-5">
                <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3 text-sm">
                  <span className="text-muted-foreground">Đã trả lời</span>
                  <span className="font-semibold tabular-nums">{answeredCount}/{questions.length} câu</span>
                </div>
                {unansweredCount > 0 ? (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    Bạn còn {unansweredCount} câu chưa trả lời. Vẫn có thể nộp bài, hoặc quay lại kiểm tra.
                  </p>
                ) : (
                  <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                    Bạn đã trả lời tất cả câu hỏi. Hãy xác nhận để nộp bài.
                  </p>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 border-t bg-muted/20 p-4 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setShowSubmitConfirm(false)}>
                  Tiếp tục làm bài
                </Button>
                <Button type="button" disabled={fetcher.state !== "idle"} onClick={() => {
                  setShowSubmitConfirm(false);
                  finalSubmit();
                }}>
                  <Send className="mr-1.5 h-4 w-4" />Xác nhận nộp bài
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
