import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { syncScheduledAttendanceSessions } from "~/lib/scheduled-attendance.server";

function isMatchingSecret(received: string | null, expected: string) {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes);
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const secret = process.env.ATTENDANCE_SESSION_CRON_SECRET;
  if (!secret) {
    console.error("[attendance-session-cron] ATTENDANCE_SESSION_CRON_SECRET is not configured");
    return new Response("Attendance session cron is not configured", { status: 503 });
  }
  const authorization = request.headers.get("Authorization");
  const receivedSecret = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  if (!isMatchingSecret(receivedSecret, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await syncScheduledAttendanceSessions();
  return Response.json({ success: true, ...result });
}
