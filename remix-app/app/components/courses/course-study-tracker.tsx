import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 30_000;
const ACTIVE_IDLE_TIMEOUT_MS = 2 * 60 * 1000;
const VISIT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

interface CourseStudyTrackerProps {
  courseId: string;
}

export function CourseStudyTracker({ courseId }: CourseStudyTrackerProps) {
  useEffect(() => {
    const endpoint = `/student/courses/${encodeURIComponent(courseId)}/activity`;
    const storageKey = `course-study-session:${courseId}`;
    const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const storedSessionId = sessionStorage.getItem(storageKey);
    let sessionId: string | null = storedSessionId;
    let lastInteractionAt = Date.now();
    let disposed = false;

    const post = async (values: Record<string, string>, keepalive = false) => {
      const response = await fetch(endpoint, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
        body: new URLSearchParams(values),
        keepalive,
      });
      if (!response.ok) throw new Error(`Không thể ghi nhận thời gian học (${response.status})`);
      return response.json() as Promise<{ sessionId?: string }>;
    };

    const startSession = async (resume: boolean, previousSessionId?: string) => {
      const result = await post({
        event: "start",
        sessionId: resume ? sessionId ?? "" : "",
        resume: String(resume),
        previousSessionId: previousSessionId ?? "",
      });
      if (!result.sessionId) throw new Error("Máy chủ không trả về mã phiên học");
      sessionId = result.sessionId;
      sessionStorage.setItem(storageKey, sessionId);
    };

    const shouldResume = navigationEntry?.type === "reload" && Boolean(storedSessionId);
    let sessionReady = startSession(shouldResume).catch((error: unknown) => {
      console.error("Không thể bắt đầu ghi nhận thời gian học:", error);
    });

    const startNewVisit = (previousSessionId: string | null) => {
      sessionId = null;
      sessionReady = startSession(false, previousSessionId ?? undefined).catch((error: unknown) => {
        console.error("Không thể bắt đầu phiên học mới:", error);
      });
    };

    const markInteraction = () => {
      const now = Date.now();
      if (now - lastInteractionAt >= VISIT_IDLE_TIMEOUT_MS) {
        startNewVisit(sessionId);
      }
      lastInteractionAt = now;
    };

    const activityEvents: (keyof WindowEventMap)[] = ["pointerdown", "keydown", "scroll", "touchstart"];
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markInteraction, { passive: true }));

    const timer = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || now - lastInteractionAt > ACTIVE_IDLE_TIMEOUT_MS) return;

      void sessionReady.then(async () => {
        if (disposed || !sessionId) return;
        const result = await post({ event: "heartbeat", sessionId, seconds: String(HEARTBEAT_INTERVAL_MS / 1000) });
        if (result.sessionId && result.sessionId !== sessionId) {
          sessionId = result.sessionId;
          sessionStorage.setItem(storageKey, sessionId);
        }
      }).catch((error: unknown) => {
        console.error("Không thể cập nhật thời gian học:", error);
      });
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markInteraction));

      if (sessionId) {
        const payload = new URLSearchParams({ event: "end", sessionId });
        if (!navigator.sendBeacon(endpoint, new Blob([payload.toString()], { type: "application/x-www-form-urlencoded;charset=UTF-8" }))) {
          void post({ event: "end", sessionId }, true).catch((error: unknown) => {
            console.error("Không thể kết thúc phiên học:", error);
          });
        }
      }
    };
  }, [courseId]);

  return null;
}
