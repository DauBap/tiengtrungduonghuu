import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, CheckCircle2, Clock3, Sparkles } from "lucide-react";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { EmptyState } from "~/components/common/empty-state";
import { getCourseById, getCourseReviewSetById } from "~/lib/db.server";
import { requireRole } from "~/lib/session.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const course = await getCourseById(params.courseId!);
  if (!course) throw new Response("Không tìm thấy khóa học", { status: 404 });

  const reviewSet = await getCourseReviewSetById(course.id, params.reviewId!);
  if (!reviewSet) throw new Response("Không tìm thấy bộ ôn tập", { status: 404 });

  return {
    user,
    course: { ...course, createdAt: course.createdAt.toISOString(), updatedAt: course.updatedAt.toISOString() },
    reviewSet: {
      ...reviewSet,
      questions: reviewSet.questions.map((question, index) => ({
        ...question,
        order: question.order || index,
      })),
    },
  };
}

function normalizeAnswer(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionCorrect(question: { answer: string; acceptedAnswers?: string[] }, provided: string) {
  const entered = normalizeAnswer(provided);
  if (!entered) return false;

  const accepted = [question.answer, ...(question.acceptedAnswers ?? [])].map((candidate) => normalizeAnswer(candidate));
  return accepted.includes(entered) || accepted.some((candidate) => candidate.includes(entered) || entered.includes(candidate));
}

export default function StudentCourseReviewPage() {
  const { user, course, reviewSet } = useLoaderData<typeof loader>();
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const orderedQuestions = useMemo(
    () => [...reviewSet.questions].sort((a, b) => a.order - b.order),
    [reviewSet.questions]
  );

  const currentQuestion = orderedQuestions[index];
  const correctCount = orderedQuestions.filter((q) => isQuestionCorrect(q, answers[q.id] ?? "")).length;
  const percentage = orderedQuestions.length === 0 ? 0 : Math.round((correctCount / orderedQuestions.length) * 100);

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((previous) => ({ ...previous, [questionId]: value }));
  };

  if (orderedQuestions.length === 0) {
    return (
      <AppShell user={user}>
        <div className="space-y-4">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/student/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <EmptyState title="Chưa có câu hỏi ôn tập" message="Bộ này hiện chưa có dữ liệu để luyện tập." />
        </div>
      </AppShell>
    );
  }

  const next = () => {
    if (index < orderedQuestions.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    setSubmitted(true);
  };

  return (
    <AppShell user={user}>
      <div className="space-y-6">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-2">
            <Link to={`/student/courses/${course.id}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Quay lại khóa học</Link>
          </Button>
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
              <BookOpen className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">Ôn tập</span>
                <span className="text-xs font-mono text-muted-foreground">{course.code}</span>
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">{reviewSet.title}</h1>
              <p className="mt-1 text-sm text-muted-foreground">{reviewSet.subtitle}</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Số câu</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-2 text-2xl font-bold"><Sparkles className="h-5 w-5 text-primary" />{orderedQuestions.length}</CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Dạng câu</CardTitle></CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {new Set(orderedQuestions.map((q) => q.type === "REORDER" ? "Sắp xếp" : "Dịch")).size} loại
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Thời gian</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground"><Clock3 className="h-4 w-4" />Tự luyện, không giới hạn</CardContent>
          </Card>
        </div>

        {!started && !submitted && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Bắt đầu luyện tập</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Bộ ôn tập này gồm các câu dịch và sắp xếp câu từ các bài đã học. Hãy trả lời từng câu và chấm điểm cuối bài.
              </p>
              <Button type="button" className="w-full" onClick={() => setStarted(true)}>Bắt đầu ôn tập</Button>
            </CardContent>
          </Card>
        )}

        {started && !submitted && currentQuestion && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-lg">Câu {index + 1} / {orderedQuestions.length}</CardTitle>
                <span className="rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                  {currentQuestion.direction === "VI2ZH" ? "Việt → Trung" : "Trung → Việt"}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground">Câu hỏi</p>
                {currentQuestion.type === "REORDER" ? (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(currentQuestion.tokens ?? []).map((token, tokenIndex) => (
                        <span key={`${currentQuestion.id}-${tokenIndex}`} className="rounded-full border bg-background px-2.5 py-1 text-sm">{token}</span>
                      ))}
                    </div>
                    <p className="text-sm text-muted-foreground">Sắp xếp các từ thành câu đúng:</p>
                  </div>
                ) : (
                  <p className="mt-3 text-xl font-semibold leading-relaxed">{currentQuestion.prompt}</p>
                )}
              </div>

              <label className="block text-sm font-medium">
                {currentQuestion.type === "REORDER" ? "Đáp án của bạn" : "Nhập đáp án"}
                <textarea
                  value={answers[currentQuestion.id] ?? ""}
                  onChange={(event) => setAnswer(currentQuestion.id, event.target.value)}
                  rows={currentQuestion.type === "REORDER" ? 2 : 4}
                  className="mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-0 focus:border-primary"
                  placeholder={currentQuestion.type === "REORDER" ? "Viết câu hoàn chỉnh theo đúng thứ tự" : "Nhập đáp án của bạn..."}
                />
              </label>

              <div className="flex items-center justify-between gap-3">
                <Button type="button" variant="outline" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
                  Câu trước
                </Button>
                <Button type="button" onClick={next}>
                  {index === orderedQuestions.length - 1 ? "Nộp bài" : "Câu tiếp theo"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {submitted && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Kết quả ôn tập</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex items-center gap-3 rounded-lg border bg-primary/5 p-4">
                <CheckCircle2 className="h-6 w-6 text-primary" />
                <div>
                  <p className="text-lg font-semibold">{correctCount}/{orderedQuestions.length} câu đúng</p>
                  <p className="text-sm text-muted-foreground">Điểm số: {percentage}%</p>
                </div>
              </div>

              <div className="space-y-3">
                {orderedQuestions.map((question, questionIndex) => {
                  const answer = answers[question.id] ?? "";
                  const isCorrect = isQuestionCorrect(question, answer);
                  return (
                    <div key={question.id} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">Câu {questionIndex + 1}</p>
                        <span className={isCorrect ? "text-green-600" : "text-red-600"}> {isCorrect ? "Đúng" : "Sai"}</span>
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{question.prompt}</p>
                      <p className="mt-2 text-sm"><span className="font-medium">Câu trả lời của bạn:</span> {answer || "(chưa trả lời)"}</p>
                      <p className="mt-1 text-sm"><span className="font-medium">Đáp án:</span> {question.answer}</p>
                    </div>
                  );
                })}
              </div>

              <Button asChild className="w-full">
                <Link to={`/student/courses/${course.id}`}>Về khóa học</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
