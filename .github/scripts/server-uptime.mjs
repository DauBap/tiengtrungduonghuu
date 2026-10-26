import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const {
  SERVER_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_API_URL = "https://api.telegram.org",
  UPTIME_STATE_FILE = ".uptime-state/status",
} = process.env;

for (const [name, value] of Object.entries({
  SERVER_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
})) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

async function readPreviousStatus() {
  try {
    const status = (await readFile(UPTIME_STATE_FILE, "utf8")).trim();
    if (status !== "up" && status !== "down") {
      throw new Error("The saved uptime state is invalid.");
    }
    return status;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function notifyTelegram(message) {
  let response;
  try {
    response = await fetch(`${TELEGRAM_API_URL}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ chat_id: TELEGRAM_CHAT_ID, text: message }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error("Could not reach Telegram to send the server alert.");
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    const description = typeof result.description === "string"
      ? result.description
      : "Telegram could not deliver the server alert.";
    throw new Error(`Telegram rejected the server alert (HTTP ${response.status}): ${description}`);
  }
}

let currentStatus = "down";
let detail = "";
try {
  const response = await fetch(SERVER_URL, {
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status >= 200 && response.status < 400) {
    currentStatus = "up";
    detail = `HTTP ${response.status}`;
  } else {
    detail = `HTTP ${response.status}`;
  }
} catch (error) {
  detail = error.name === "TimeoutError" ? "timeout" : "không kết nối được";
}

const previousStatus = await readPreviousStatus();
if (currentStatus !== previousStatus) {
  if (currentStatus === "down") {
    await notifyTelegram(
      `🔴 CẢNH BÁO: Server Tiếng Trung Dương Hữu mất kết nối.\nURL: ${SERVER_URL}\nChi tiết: ${detail}\nGitHub Actions kiểm tra mỗi 5 phút.`,
    );
  } else {
    const message = previousStatus === "down"
      ? `✅ ĐÃ KHÔI PHỤC: Server Tiếng Trung Dương Hữu hoạt động trở lại (${detail}).`
      : `✅ Giám sát server Tiếng Trung Dương Hữu đã bắt đầu; server đang hoạt động (${detail}).`;
    await notifyTelegram(message);
  }
  await mkdir(dirname(UPTIME_STATE_FILE), { recursive: true });
  await writeFile(UPTIME_STATE_FILE, `${currentStatus}\n`, { mode: 0o600 });
  if (process.env.GITHUB_OUTPUT) {
    await writeFile(process.env.GITHUB_OUTPUT, "state-changed=true\n", { flag: "a" });
  }
}

console.log(`Server ${currentStatus}: ${detail}.`);
