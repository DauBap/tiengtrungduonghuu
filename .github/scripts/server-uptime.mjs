const {
  SERVER_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  TELEGRAM_API_URL = "https://api.telegram.org",
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_API_URL,
} = process.env;

for (const [name, value] of Object.entries({
  SERVER_URL,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  GITHUB_API_URL,
})) {
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
}

const variableName = "TIENGTRUNG_SERVER_UPTIME";
const variableUrl = `${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/variables/${variableName}`;
const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, ...options.headers },
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function readPreviousStatus() {
  const { response, body } = await githubRequest(variableUrl);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Could not read uptime state from GitHub (HTTP ${response.status}).`);
  }
  if (body.name !== variableName || !["up", "down"].includes(body.value)) {
    throw new Error("The saved GitHub uptime state is invalid.");
  }
  return body.value;
}

async function saveStatus(status) {
  const { response, body } = await githubRequest(variableUrl, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: variableName, value: status }),
  });

  if (response.status === 404) {
    const create = await githubRequest(`${GITHUB_API_URL}/repos/${GITHUB_REPOSITORY}/actions/variables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: variableName, value: status }),
    });
    if (!create.response.ok) {
      throw new Error(`Could not create uptime state in GitHub (HTTP ${create.response.status}).`);
    }
    return;
  }

  if (!response.ok) {
    throw new Error(`Could not save uptime state to GitHub (HTTP ${response.status}).`);
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
    throw new Error(`Telegram rejected the server alert (HTTP ${response.status}).`);
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
}

await saveStatus(currentStatus);
console.log(`Server ${currentStatus}: ${detail}.`);
