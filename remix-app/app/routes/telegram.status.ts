import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { prisma } from "~/lib/prisma.server";

const TELEGRAM_API_URL = "https://api.telegram.org";
const MAX_UPDATE_BYTES = 64 * 1024;
const ONLINE_WINDOW_SECONDS = 2 * 60;

function isMatchingSecret(received: string | null, expected: string) {
  if (!received) return false;
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return receivedBytes.length === expectedBytes.length
    && timingSafeEqual(receivedBytes, expectedBytes);
}

async function sendTelegramMessage(botToken: string, chatId: string, text: string) {
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API_URL}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("[telegram-status] Could not reach Telegram", error);
    throw new Response("Telegram is unavailable", { status: 502 });
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch (error) {
    console.error("[telegram-status] Telegram returned invalid JSON", error);
    throw new Response("Telegram returned an invalid response", { status: 502 });
  }

  if (!response.ok || !isRecord(result) || result.ok !== true) {
    console.error("[telegram-status] Telegram rejected status reply", { status: response.status });
    throw new Response("Telegram could not deliver the status reply", { status: 502 });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function loader(_args: LoaderFunctionArgs) {
  return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const allowedChatId = process.env.TELEGRAM_CHAT_ID;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!botToken || !allowedChatId || !webhookSecret) {
    console.error("[telegram-status] Telegram bot configuration is incomplete");
    return new Response("Telegram status is not configured", { status: 503 });
  }

  if (!isMatchingSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), webhookSecret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const contentLength = Number(request.headers.get("Content-Length") ?? 0);
  if (contentLength > MAX_UPDATE_BYTES) {
    return new Response("Request too large", { status: 413 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (!isRecord(update) || !isRecord(update.message)) {
    return Response.json({ ok: true });
  }

  const message = update.message;
  const chat = message.chat;
  if (!isRecord(chat) || String(chat.id) !== allowedChatId) {
    return Response.json({ ok: true });
  }

  if (typeof message.text !== "string" || !/^\/status(?:@[a-zA-Z0-9_]+)?(?:\s|$)/i.test(message.text)) {
    return Response.json({ ok: true });
  }

  const result = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(DISTINCT session."userId")::bigint AS count
    FROM public."CourseStudySession" AS session
    INNER JOIN public."User" AS app_user ON app_user.id = session."userId"
    WHERE session."lastActiveAt" >= NOW() - (${ONLINE_WINDOW_SECONDS} * INTERVAL '1 second')
      AND session."endedAt" IS NULL
      AND app_user.role = 'student'
      AND app_user."isActive" = true
      AND app_user."deletedAt" IS NULL
  `;
  const onlineCount = Number(result[0]?.count ?? 0n);
  const reply = `👥 Học viên đang online trong khóa học: ${onlineCount}\n(hoạt động trong 2 phút gần nhất)`;

  await sendTelegramMessage(botToken, allowedChatId, reply);
  return Response.json({ ok: true });
}
