import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { Bell, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";

interface NotificationItem {
  id: string;
  kind: string;
  title: string;
  message: string;
  targetUrl: string;
  readAt: Date | null;
  createdAt: Date;
}

interface NotificationList {
  notifications: NotificationItem[];
  unreadCount: number;
  error?: string | null;
}

interface MarkNotificationResult {
  success?: boolean;
  notificationId?: string;
  targetUrl?: string;
  error?: string;
}

export function GradingNotifications() {
  const navigate = useNavigate();
  const listFetcher = useFetcher<NotificationList>();
  const markFetcher = useFetcher<MarkNotificationResult>();
  const listFetcherRef = useRef(listFetcher);
  const navigateRef = useRef(navigate);
  const openNotificationRef = useRef<(notificationId: string) => void>(() => {});
  const [isOpen, setIsOpen] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const handledNotificationId = useRef<string | null>(null);
  const hasHandledInitialNotifications = useRef(false);
  const knownNotificationIds = useRef(new Set<string>());
  const openNotification = (notificationId: string) => {
    if (markFetcher.state !== "idle") return;
    handledNotificationId.current = null;
    setOpeningId(notificationId);
    markFetcher.submit(
      { notificationId },
      { method: "post", action: "/api/notifications" },
    );
  };

  listFetcherRef.current = listFetcher;
  navigateRef.current = navigate;
  openNotificationRef.current = openNotification;

  useEffect(() => {
    const refresh = () => listFetcherRef.current.load("/api/notifications");
    refresh();
    const intervalId = window.setInterval(refresh, 30_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  useEffect(() => {
    if (
      listFetcher.state !== "idle"
      || !listFetcher.data
      || listFetcher.data.error
    ) return;

    const unreadNotifications = listFetcher.data.notifications.filter(({ readAt }) => !readAt);
    const notificationsToToast = hasHandledInitialNotifications.current
      ? unreadNotifications.filter(({ id }) => !knownNotificationIds.current.has(id))
      : unreadNotifications;
    for (const notification of listFetcher.data.notifications) {
      knownNotificationIds.current.add(notification.id);
    }
    hasHandledInitialNotifications.current = true;
    notificationsToToast.slice(0, 3).forEach((notification) => {
      toast(notification.title, {
        className: "grading-notification-toast",
        description: notification.message,
        duration: 8_000,
        action: {
          label: notification.kind === "ACCOUNT_ACTIVATION_REQUEST"
            ? "Xem tài khoản"
            : notification.kind === "ACCOUNT_ACTIVATED"
              ? "Xem lớp học"
              : notification.kind.endsWith("_GRADING_REQUEST")
                ? "Chấm bài"
                : "Xem kết quả",
          onClick: () => openNotificationRef.current(notification.id),
        },
      });
    });

    if (notificationsToToast.length > 3) {
      toast("Có thêm thông báo mới", {
        className: "grading-notification-toast",
        description: `Bạn có thêm ${notificationsToToast.length - 3} thông báo mới chưa đọc.`,
        duration: 8_000,
        action: {
          label: "Mở hộp thư",
          onClick: () => setIsOpen(true),
        },
      });
    }
  }, [listFetcher.data, listFetcher.state]);

  useEffect(() => {
    const result = markFetcher.data;
    if (
      markFetcher.state !== "idle"
      || !result?.success
      || !result.notificationId
      || !result.targetUrl
      || result.notificationId !== openingId
      || handledNotificationId.current === result.notificationId
    ) return;
    handledNotificationId.current = result.notificationId;
    listFetcherRef.current.load("/api/notifications");
    navigateRef.current(result.targetUrl);
  }, [markFetcher.data, markFetcher.state, openingId]);

  const notifications = listFetcher.data?.notifications ?? [];
  const unreadCount = listFetcher.data?.unreadCount ?? 0;

  return (
    <div className="fixed right-4 top-3 z-50">
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label={unreadCount > 0 ? `Thông báo, ${unreadCount} chưa đọc` : "Thông báo"}
        aria-expanded={isOpen}
        aria-controls="grading-notifications-panel"
        onClick={() => setIsOpen((open) => !open)}
        className="relative h-11 w-11 rounded-lg bg-background shadow-sm"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground tabular-nums">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <section
          id="grading-notifications-panel"
          role="dialog"
          aria-label="Thông báo"
          className="absolute right-0 top-14 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-lg border bg-background shadow-xl"
        >
          <header className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">Thông báo</h2>
            <span className="text-xs text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} chưa đọc` : "Đã cập nhật"}
            </span>
          </header>
          {markFetcher.data?.error && (
            <p role="alert" className="border-b bg-destructive/5 px-4 py-2 text-sm text-destructive">
              {markFetcher.data.error}
            </p>
          )}
          {listFetcher.data?.error ? (
            <p role="alert" className="p-4 text-sm text-destructive">{listFetcher.data.error}</p>
          ) : listFetcher.state === "loading" && notifications.length === 0 ? (
            <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Đang tải thông báo...
            </div>
          ) : notifications.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">Bạn chưa có thông báo nào.</p>
          ) : (
            <ul className="max-h-[min(70vh,28rem)] divide-y overflow-y-auto">
              {notifications.map((notification) => {
                const isOpening = openingId === notification.id && markFetcher.state !== "idle";
                return (
                  <li key={notification.id}>
                    <button
                      type="button"
                      disabled={markFetcher.state !== "idle"}
                      onClick={() => openNotification(notification.id)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait ${notification.readAt ? "" : "bg-primary/[0.04]"}`}
                    >
                      <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${notification.readAt ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                        {isOpening
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : notification.readAt
                            ? <Check className="h-4 w-4" />
                            : <Bell className="h-4 w-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{notification.title}</span>
                        <span className="mt-0.5 block text-sm leading-5 text-muted-foreground">{notification.message}</span>
                        <time className="mt-1.5 block text-xs text-muted-foreground" dateTime={new Date(notification.createdAt).toISOString()}>
                          {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(notification.createdAt))}
                        </time>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
