import { useState } from "react";
import { useFetcher } from "react-router";
import { AlertTriangle, Check, X } from "lucide-react";
import type { ConsecutiveAbsenceAlert } from "~/lib/attendance-streak.server";
import { Overlay } from "~/components/common/overlay";
import { Button } from "~/components/ui/button";

type DisplayAlert = Omit<ConsecutiveAbsenceAlert, "sessionDate" | "sessionCreatedAt">;

export function ConsecutiveAbsenceBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
      <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
      Vắng 3 buổi liên tiếp
    </span>
  );
}

export function ConsecutiveAbsenceNotice({ alerts }: { alerts: DisplayAlert[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const fetcher = useFetcher<{ intent: string; success: boolean; studentId?: string; error?: string }>();

  if (alerts.length === 0) return null;

  return (
    <>
      <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 text-sm text-destructive">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-haspopup="dialog"
          className="flex w-full items-start gap-2 rounded-md px-4 py-3 text-left hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <span className="font-semibold">Có học sinh vắng 3 buổi liên tiếp</span>
            <span className="mt-0.5 block text-destructive/90">
              {alerts.map(({ className, studentName }) => `${className} - ${studentName}`).join("; ")}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">Chọn để xem chi tiết và đánh dấu đã xử lý.</span>
          </span>
        </button>
      </div>

      {isOpen && (
        <Overlay onClose={() => setIsOpen(false)} className="max-w-xl">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="consecutive-absence-dialog-title"
            className="space-y-4"
            onKeyDown={(event) => {
              if (event.key === "Escape") setIsOpen(false);
            }}
          >
            <header className="flex items-start justify-between gap-4">
              <div>
                <h2 id="consecutive-absence-dialog-title" className="text-lg font-semibold">
                  Học sinh vắng 3 buổi liên tiếp
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Đánh dấu từng học sinh sau khi đã liên hệ hoặc xử lý.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Đóng"
                autoFocus
                onClick={() => setIsOpen(false)}
                className="-mr-2 -mt-2 shrink-0"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </Button>
            </header>

            <ul className="divide-y rounded-md border">
              {alerts.map((alert) => {
                const isHandling = fetcher.state !== "idle" && fetcher.formData?.get("studentId") === alert.studentId;
                const actionError = fetcher.data?.success === false
                  && fetcher.data.studentId === alert.studentId
                  ? fetcher.data.error
                  : null;
                return (
                  <li key={`${alert.classId}:${alert.studentId}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-medium">{alert.studentName}</p>
                      <p className="text-sm text-muted-foreground">
                        Lớp {alert.className} · {alert.sessions.map((session) =>
                          `${session.title || "Buổi học"} (${session.date.split("-").reverse().join("/")})`,
                        ).join(" → ")}
                      </p>
                      {actionError && <p role="alert" className="mt-1 text-sm text-destructive">{actionError}</p>}
                    </div>
                    <fetcher.Form method="post">
                      <input type="hidden" name="intent" value="dismiss-absence-alert" />
                      <input type="hidden" name="classId" value={alert.classId} />
                      <input type="hidden" name="studentId" value={alert.studentId} />
                      <input type="hidden" name="sessionId" value={alert.sessionId} />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={fetcher.state !== "idle"}
                        className="w-full gap-2 sm:w-auto"
                      >
                        {isHandling
                          ? <><Check aria-hidden="true" className="h-4 w-4" /> Đang lưu...</>
                          : <><Check aria-hidden="true" className="h-4 w-4" /> Đã xử lý</>}
                      </Button>
                    </fetcher.Form>
                  </li>
                );
              })}
            </ul>

            {fetcher.data?.success === false && !fetcher.data.studentId && (
              <p role="alert" className="text-sm text-destructive">{fetcher.data.error}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Cảnh báo sẽ xuất hiện lại nếu học sinh vắng liên tiếp thêm 3 buổi sau khi chuỗi vắng bị ngắt.
            </p>
          </section>
        </Overlay>
      )}
    </>
  );
}
