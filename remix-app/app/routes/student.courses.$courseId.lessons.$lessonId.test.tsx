import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, Link, Form } from "react-router";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";
import { getLessonById, getLessonProgress, upsertLessonProgress, computeLessonStatus } from "~/lib/db.server";
import { gradeLessonTest, parseTestResponses } from "~/lib/lesson-test";
import { GRAMMAR_QUESTION_META, grammarAnswerText, shuffledTokens } from "~/lib/grammar";
import { AppShell } from "~/components/layout/app-shell";
import { LockedContent } from "~/components/lessons/locked-content";
import { LessonTest, type LessonTestQuestion } from "~/components/lessons/lesson-test";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/ui/badge";
import { Progress } from "~/components/ui/progress";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import {
  ArrowLeft, CheckCircle2, XCircle, PartyPopper, RefreshCw, ClipboardCheck, Lightbulb,
} from "lucide-react";
import { cn } from "~/lib/utils";

/** Kết quả một câu, chỉ dựng SAU khi nộp — lúc này mới được tiết lộ đáp án. */
interface QuestionResult {
  id: string;
  prompt: string;
  typeLabel: string;
  points: number;
  correct: boolean;
  /** Học viên đã trả lời gì; rỗng nghĩa là bỏ trống */
  given: string;
  correctAnswer: string;
  hint: string | null;
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const lesson = await getLessonById(params.lessonId!);
  if (!lesson) throw new Response("Không tìm thấy", { status: 404 });
  const progress = await getLessonProgress(user.id, lesson.id);
  const lessonStatus = computeLessonStatus(progress);

  // `select` tường minh, KHÔNG `include: { questions: true }` — `answer` và
  // `hint` không được xuống client trước khi nộp. Đây là điểm bảo mật của route.
  const rows = lesson.test
    ? await prisma.testQuestion.findMany({
        where: { testId: lesson.test.id },
        orderBy: { order: "asc" },
        select: { id: true, type: true, prompt: true, options: true, points: true },
      })
    : [];

  // Trộn ở server: với ARRANGE, thứ tự gốc của `options` CHÍNH LÀ đáp án, gửi
  // nguyên xuống thì đọc payload loader là biết ngay.
  const questions: LessonTestQuestion[] = rows.map((q) => ({
    ...q,
    options: q.type === "ARRANGE" ? shuffledTokens(q.options) : q.options,
  }));

  return { user, lesson, lessonStatus, questions, passScore: lesson.test?.passScore ?? 50 };
}

export async function action({ request, params }: ActionFunctionArgs) {
  const user = await requireRole(request, ["student"]);
  const lessonId = params.lessonId!;

  const test = await prisma.test.findUnique({
    where: { lessonId },
    select: { id: true, passScore: true },
  });
  if (!test) throw new Response("Không tìm thấy bài kiểm tra", { status: 404 });

  // Đọc lại câu hỏi KÈM `answer` từ DB. Client chỉ gửi câu trả lời, không bao
  // giờ gửi điểm hay đáp án lên — chấm điểm chỉ xảy ra ở đây.
  const questions = await prisma.testQuestion.findMany({
    where: { testId: test.id },
    orderBy: { order: "asc" },
    select: {
      id: true, type: true, prompt: true, options: true, answer: true, hint: true, points: true,
    },
  });
  if (questions.length === 0) {
    return { error: "Bài kiểm tra này chưa có câu hỏi nào." as const };
  }

  const form = await request.formData();
  const responses = parseTestResponses(form, questions.map((q) => q.id));
  const grade = gradeLessonTest(questions, responses, test.passScore);

  // Chỉ đạt điểm sàn mới tính hoàn thành; chưa đạt thì học viên làm lại được
  if (grade.passed) {
    await upsertLessonProgress(user.id, lessonId, { testCompleted: true });
  }

  const results: QuestionResult[] = questions.map((q) => {
    const response = responses.get(q.id);
    const given = Array.isArray(response) ? response.join("") : (response ?? "");
    return {
      id: q.id,
      prompt: q.prompt,
      typeLabel: GRAMMAR_QUESTION_META[q.type].label,
      points: q.points,
      correct: grade.perQuestion.get(q.id) ?? false,
      given: given.trim(),
      correctAnswer: grammarAnswerText(q),
      hint: q.hint,
    };
  });

  return {
    result: {
      percentage: grade.percentage,
      earnedPoints: grade.earnedPoints,
      totalPoints: grade.totalPoints,
      correctCount: grade.correctCount,
      blankCount: grade.blankCount,
      passed: grade.passed,
      passScore: test.passScore,
      questionCount: questions.length,
      results,
    },
  };
}

export default function TestPage() {
  const { user, lesson, lessonStatus, questions, passScore } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const result = actionData && "result" in actionData ? actionData.result : null;

  const backToLesson = (
    <Button asChild variant="ghost" size="sm" className="mb-2">
      <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}`}>
        <ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học
      </Link>
    </Button>
  );

  if (lessonStatus.testStatus === "LOCKED") {
    return (
      <AppShell user={user}>
        <div className="space-y-6 max-w-3xl">
          <Button asChild variant="ghost" size="sm">
            <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}`}>
              <ArrowLeft className="h-4 w-4 mr-1.5" />Quay lại bài học
            </Link>
          </Button>
          <LockedContent title="Bài kiểm tra chưa mở khóa" message="Hãy hoàn thành bài tập trước để mở khóa bài kiểm tra." />
        </div>
      </AppShell>
    );
  }

  const header = (
    <div>
      {backToLesson}
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
          HSK {lesson.course.hskLevel}
        </span>
        <span>{lesson.title} - Kiểm tra</span>
      </div>
      <h1 className="text-2xl font-bold tracking-tight">{lesson.test?.title ?? "Bài kiểm tra"}</h1>
    </div>
  );

  // Chưa soạn câu hỏi: nói rõ chưa có bài, không hiện form trống
  if (questions.length === 0) {
    return (
      <AppShell user={user}>
        <div className="space-y-6 max-w-3xl">
          {header}
          <Card>
            <CardContent className="py-12 text-center">
              <ClipboardCheck className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
              <p className="font-medium">Bài học này chưa có bài kiểm tra</p>
              <p className="text-sm text-muted-foreground mt-1 mb-5">
                Giáo viên chưa soạn câu hỏi cho phần kiểm tra. Bạn hãy quay lại sau nhé.
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to={`/student/courses/${lesson.courseId}`}>Quay lại khóa học</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Đã nộp: hiện điểm và chi tiết từng câu
  if (result) {
    return (
      <AppShell user={user}>
        <div className="space-y-6 max-w-3xl">
          {header}

          <Card className={cn(result.passed ? "border-success/40" : "border-destructive/40")}>
            <CardContent className="pt-6 space-y-4">
              <div className="flex flex-col items-center text-center gap-2">
                {result.passed ? (
                  <>
                    <PartyPopper className="h-10 w-10 text-success" />
                    <p className="text-lg font-bold text-success">Đạt — bài học hoàn tất!</p>
                  </>
                ) : (
                  <>
                    <XCircle className="h-10 w-10 text-destructive" />
                    <p className="text-lg font-bold text-destructive">Chưa đạt</p>
                    <p className="text-sm text-muted-foreground">
                      Cần từ {result.passScore}% trở lên. Bạn làm lại được bao nhiêu lần cũng không sao.
                    </p>
                  </>
                )}
                <p className="text-4xl font-bold tabular-nums mt-1">{result.percentage}%</p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {result.earnedPoints}/{result.totalPoints} điểm · đúng {result.correctCount}/{result.questionCount} câu
                  {result.blankCount > 0 && ` · bỏ trống ${result.blankCount} câu`}
                </p>
              </div>

              <div className="space-y-1.5">
                <Progress value={result.percentage} className="h-2" />
                <p className="text-xs text-muted-foreground text-right">Điểm đạt: {result.passScore}%</p>
              </div>

              <div className="flex flex-wrap gap-2 justify-center pt-1">
                {result.passed ? (
                  <Button asChild>
                    <Link to={`/student/courses/${lesson.courseId}`}>Quay lại khóa học</Link>
                  </Button>
                ) : (
                  <>
                    {/* Tải lại route để loader trộn lại các từ và xoá kết quả cũ */}
                    <Button asChild>
                      <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}/test`} reloadDocument>
                        <RefreshCw className="h-4 w-4 mr-1.5" />Làm lại
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link to={`/student/courses/${lesson.courseId}/lessons/${lesson.id}`}>Xem lại bài học</Link>
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Chi tiết từng câu</CardTitle>
              <CardDescription>Đối chiếu đáp án đúng để lần sau làm tốt hơn.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.results.map((q, i) => (
                <div key={q.id}
                  className={cn("rounded-lg border p-3 space-y-1.5",
                    q.correct ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
                  <div className="flex items-start gap-2">
                    {q.correct
                      ? <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" />
                      : <XCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
                        <p className="font-medium">{q.prompt}</p>
                        <Badge variant="outline" className="bg-background/60 text-muted-foreground text-[10px]">
                          {q.typeLabel}
                        </Badge>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {q.correct ? q.points : 0}/{q.points} điểm
                        </span>
                      </div>
                      <p className="text-sm">
                        <span className="text-muted-foreground">Bạn trả lời: </span>
                        {q.given
                          ? <span className={q.correct ? "text-success" : "text-destructive"}>{q.given}</span>
                          : <span className="italic text-muted-foreground">bỏ trống</span>}
                      </p>
                      {!q.correct && (
                        <p className="text-sm">
                          <span className="text-muted-foreground">Đáp án đúng: </span>
                          <span className="font-medium">{q.correctAnswer}</span>
                        </p>
                      )}
                      {q.hint && (
                        <p className="flex items-start gap-1.5 text-sm text-muted-foreground whitespace-pre-line">
                          <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />{q.hint}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
  }

  // Chưa nộp lần này: hiện form làm bài
  return (
    <AppShell user={user}>
      <div className="space-y-6 max-w-3xl">
        {header}

        {lessonStatus.testStatus === "COMPLETED" && (
          <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">
            <PartyPopper className="h-4 w-4 shrink-0" />
            <span className="font-medium">Bạn đã đạt bài kiểm tra này. Làm lại để ôn cũng được.</span>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {questions.length} câu · cần {passScore}% để đạt
            </CardTitle>
            <CardDescription>
              Trả lời hết rồi bấm Nộp bài, hệ thống sẽ chấm và cho biết điểm.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {actionData && "error" in actionData && actionData.error && (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {actionData.error}
              </div>
            )}
            <Form method="post">
              <LessonTest questions={questions} />
            </Form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
