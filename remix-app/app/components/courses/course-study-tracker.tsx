import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 1_000;
const HEARTBEAT_BATCH_SECONDS = 30;
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
    let pendingActiveSeconds = 0;
    let heartbeatRequest: Promise<void> | null = null;
    let retryAfter = 0;

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

      pendingActiveSeconds += 1;
      if (
        pendingActiveSeconds < HEARTBEAT_BATCH_SECONDS
        || heartbeatRequest
        || Date.now() < retryAfter
      ) return;

      pendingActiveSeconds -= HEARTBEAT_BATCH_SECONDS;
      heartbeatRequest = (async () => {
        try {
          await sessionReady;
          if (!sessionId) {
            pendingActiveSeconds += HEARTBEAT_BATCH_SECONDS;
            return;
          }

          const result = await post({
            event: "heartbeat",
            sessionId,
            seconds: String(HEARTBEAT_BATCH_SECONDS),
          });
          if (result.sessionId && result.sessionId !== sessionId) {
            sessionId = result.sessionId;
            sessionStorage.setItem(storageKey, sessionId);
          }
          retryAfter = 0;
        } catch (error) {
          pendingActiveSeconds += HEARTBEAT_BATCH_SECONDS;
          retryAfter = Date.now() + HEARTBEAT_BATCH_SECONDS * 1000;
          console.error("Không thể cập nhật thời gian học:", error);
        } finally {
          heartbeatRequest = null;
        }
      })();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markInteraction));

      void (async () => {
        await heartbeatRequest;
        if (!sessionId) return;
        await post({
          event: "end",
          sessionId,
          seconds: String(pendingActiveSeconds),
        }, true);
      })().catch((error: unknown) => {
        console.error("Không thể kết thúc phiên học:", error);
      });
    };
  }, [courseId]);

  return null;
}
