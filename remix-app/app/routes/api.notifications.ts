import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Prisma } from "@prisma/client";
import { prisma } from "~/lib/prisma.server";
import { requireRole } from "~/lib/session.server";

function isMissingNotificationTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin", "teacher", "student"]);
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.userNotification.findMany({
        where: { recipientId: user.id },
        orderBy: { createdAt: "desc" },
        take: 25,
        select: {
          id: true,
          kind: true,
          title: true,
          message: true,
          targetUrl: true,
          readAt: true,
          createdAt: true,
        },
      }),
      prisma.userNotification.count({
        where: { recipientId: user.id, readAt: null },
      }),
    ]);
    return { notifications, unreadCount, error: null };
  } catch (error) {
    if (isMissingNotificationTable(error)) {
      return {
        notifications: [],
        unreadCount: 0,
        error: "Cần cập nhật database trước khi dùng thông báo. Hãy chạy npx prisma db push trong thư mục remix-app.",
      };
    }
    throw error;
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const user = await requireRole(request, ["admin", "teacher", "student"]);
  const form = await request.formData();
  const notificationId = String(form.get("notificationId") ?? "").trim();
  if (!notificationId) return { error: "Không tìm thấy thông báo cần mở." };

  try {
    const notification = await prisma.userNotification.findFirst({
      where: { id: notificationId, recipientId: user.id },
      select: { id: true, targetUrl: true },
    });
    if (!notification) return { error: "Thông báo không tồn tại hoặc bạn không có quyền truy cập." };
    const requestUrl = new URL(request.url);
    const targetUrl = new URL(notification.targetUrl, requestUrl);
    if (targetUrl.origin !== requestUrl.origin) {
      throw new Error("Stored notification target must be an internal path");
    }

    await prisma.userNotification.updateMany({
      where: { id: notification.id, recipientId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return {
      success: true,
      notificationId: notification.id,
      targetUrl: `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`,
    };
  } catch (error) {
    if (isMissingNotificationTable(error)) {
      return { error: "Cần cập nhật database trước khi dùng thông báo. Hãy chạy npx prisma db push trong thư mục remix-app." };
    }
    throw error;
  }
}
