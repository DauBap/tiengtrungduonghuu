import { X } from "lucide-react";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";

type StudentInfoPerson = {
  name: string;
  phone: string | null;
  email: string | null;
};

type StudentInfoClass = {
  name: string;
  teacherName: string | null;
  courseLabel?: string;
  statusLabel?: string;
  enrolledAt?: Date | null;
  completedAt?: Date | null;
};

export type StudentInfoEvaluation = {
  id: string;
  sessionType: "MIDTERM" | "FINAL";
  sessionNumber: number;
  status: string;
  updatedAt: Date;
  teacherName: string | null;
};

export type StudentInfoFinalResult = {
  score: number;
  comment: string;
  attendedSessions: number;
  totalSessions: number;
  decision: string | null;
};

export function StudentInfoModal({
  student,
  classInfo,
  evaluations,
  finalResult,
  onClose,
}: {
  student: StudentInfoPerson;
  classInfo?: StudentInfoClass;
  evaluations?: StudentInfoEvaluation[];
  finalResult?: StudentInfoFinalResult | null;
  onClose: () => void;
}) {
  const showEvaluations = evaluations !== undefined || finalResult !== undefined;
  const sortedEvaluations = [...(evaluations ?? [])].sort((left, right) =>
    left.sessionType.localeCompare(right.sessionType) || left.sessionNumber - right.sessionNumber);

  return (
    <Overlay className="max-w-xl" closeOnBackdrop closeOnEscape onClose={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="student-info-modal-title" className="space-y-4">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="student-info-modal-title" className="text-lg font-semibold">{student.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {classInfo ? "Thông tin lớp học và đánh giá" : "Thông tin học viên"}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Đóng thông tin học viên">
            <X aria-hidden="true" className="h-4 w-4" />
          </Button>
        </header>

        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {classInfo && (
            <>
              <div>
                <dt className="text-muted-foreground">Lớp học</dt>
                <dd className="mt-1 font-medium">{classInfo.name}</dd>
              </div>
              {classInfo.courseLabel && (
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">Khóa học</dt>
                  <dd className="mt-1 break-words font-medium">{classInfo.courseLabel}</dd>
                </div>
              )}
              <div>
                <dt className="text-muted-foreground">Giáo viên chủ nhiệm</dt>
                <dd className="mt-1 font-medium">{classInfo.teacherName ?? "Chưa phân công"}</dd>
              </div>
              {classInfo.statusLabel && (
                <div>
                  <dt className="text-muted-foreground">Trạng thái lớp</dt>
                  <dd className="mt-1 font-medium">{classInfo.statusLabel}</dd>
                </div>
              )}
              {classInfo.enrolledAt && (
                <div>
                  <dt className="text-muted-foreground">Ngày ghi danh</dt>
                  <dd className="mt-1 font-medium">
                    {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(classInfo.enrolledAt)}
                  </dd>
                </div>
              )}
              {classInfo.completedAt && (
                <div>
                  <dt className="text-muted-foreground">Ngày kết thúc</dt>
                  <dd className="mt-1 font-medium">
                    {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(classInfo.completedAt)}
                  </dd>
                </div>
              )}
            </>
          )}
          <div>
            <dt className="text-muted-foreground">Số điện thoại</dt>
            <dd className="mt-1 font-medium">{student.phone || "Chưa cập nhật"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="mt-1 break-all font-medium">{student.email || "Chưa cập nhật"}</dd>
          </div>
        </dl>

        {showEvaluations && (
          <section aria-labelledby="student-class-evaluations-heading" className="space-y-2 border-t pt-3">
            <h3 id="student-class-evaluations-heading" className="font-semibold">Kết quả đánh giá</h3>
            {sortedEvaluations.length === 0 && !finalResult ? (
              <p className="rounded-md bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
                Chưa có kết quả đánh giá cho lớp này.
              </p>
            ) : (
              <div className="space-y-2">
                {sortedEvaluations.map((evaluation) => (
                  <div key={evaluation.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">
                        {evaluation.sessionType === "MIDTERM" ? "Giữa kỳ" : "Cuối kỳ"} · Buổi {evaluation.sessionNumber}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(evaluation.updatedAt)}
                        {evaluation.teacherName ? ` · ${evaluation.teacherName}` : ""}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      evaluation.status === "CAN_ADVANCE"
                        ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        : evaluation.status === "CANNOT_ADVANCE"
                          ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                          : evaluation.status === "DROPPED_OUT"
                            ? "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
                            : "bg-muted text-muted-foreground"
                    }`}>
                      {evaluation.status === "CAN_ADVANCE"
                        ? "Có khả năng học lên"
                        : evaluation.status === "CANNOT_ADVANCE"
                          ? "Không có khả năng học lên"
                          : evaluation.status === "DROPPED_OUT"
                            ? "Bỏ học"
                            : "Chưa xác định"}
                    </span>
                  </div>
                ))}
                {finalResult && (
                  <div className="space-y-1.5 rounded-md border px-3 py-2 text-sm">
                    <p className="font-medium">Kết quả cuối khóa</p>
                    <p className="tabular-nums">
                      Điểm {finalResult.score}/10 · Chuyên cần {finalResult.attendedSessions}/{finalResult.totalSessions} buổi
                    </p>
                    {finalResult.decision && (
                      <p className="text-muted-foreground">
                        {finalResult.decision === "PROMOTE"
                          ? "Học lên"
                          : finalResult.decision === "ELIGIBLE_NOT_ENROLLED"
                            ? "Đủ điều kiện, chưa ghi danh"
                            : finalResult.decision === "REPEAT"
                              ? "Học lại"
                              : finalResult.decision}
                      </p>
                    )}
                    {finalResult.comment && (
                      <p className="whitespace-pre-wrap break-words text-muted-foreground">{finalResult.comment}</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <div className="flex justify-end border-t pt-3">
          <Button type="button" variant="outline" onClick={onClose}>Đóng</Button>
        </div>
      </section>
    </Overlay>
  );
}
