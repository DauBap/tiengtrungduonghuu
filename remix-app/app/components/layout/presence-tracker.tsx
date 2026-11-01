import { useEffect } from "react";

const PRESENCE_INTERVAL_MS = 30_000;
const ACTIVE_IDLE_TIMEOUT_MS = 2 * 60 * 1000;

export function PresenceTracker() {
  useEffect(() => {
    let lastActivityAt = Date.now();
    let lastAttemptAt = 0;
    let requestInFlight = false;
    let hasLoggedFailure = false;

    const sendHeartbeat = async () => {
      if (document.visibilityState !== "visible" || requestInFlight) return;
      requestInFlight = true;
      lastAttemptAt = Date.now();

      try {
        const response = await fetch("/api/presence", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!response.ok || response.redirected) {
          throw new Error(`Presence update failed (${response.status})`);
        }
        hasLoggedFailure = false;
      } catch (error) {
        if (!hasLoggedFailure) {
          console.error("Không thể cập nhật trạng thái online:", error);
          hasLoggedFailure = true;
        }
      } finally {
        requestInFlight = false;
      }
    };

    const markActivity = () => {
      lastActivityAt = Date.now();
      if (lastActivityAt - lastAttemptAt >= PRESENCE_INTERVAL_MS) void sendHeartbeat();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") markActivity();
    };

    const activityEvents: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "scroll",
      "touchstart",
    ];
    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, markActivity, { passive: true });
    });
    window.addEventListener("focus", markActivity);
    document.addEventListener("visibilitychange", onVisibilityChange);

    void sendHeartbeat();
    const timer = window.setInterval(() => {
      if (
        document.visibilityState === "visible"
        && Date.now() - lastActivityAt <= ACTIVE_IDLE_TIMEOUT_MS
      ) {
        void sendHeartbeat();
      }
    }, PRESENCE_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, markActivity);
      });
      window.removeEventListener("focus", markActivity);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  return null;
}
