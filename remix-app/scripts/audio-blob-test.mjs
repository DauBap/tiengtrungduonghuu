// Upload MP3 trong public/audio lên Vercel Blob và trỏ DB test sang URL mới.
//
// `vercel env run` chỉ inject biến gắn với git branch nên BLOB_READ_WRITE_TOKEN
// bị bỏ qua. Vì vậy pull env Preview ra file tạm giống push-test.mjs.
//
//   npm run audio:blob:test         # dry run
//   npm run audio:blob:test -- --apply

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const remixApp = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(remixApp, "..");

function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/);
    if (m && m[2]) out[m[1]] = m[2];
  }
  return out;
}

const localEnv = parseEnvFile(join(repoRoot, ".env.local"));
const passthrough = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "audio-blob-"));
const envFile = join(dir, ".env");

try {
  execFileSync(
    "vercel",
    ["env", "pull", envFile, "--environment=preview", "--git-branch=test", "--yes"],
    { stdio: "inherit", shell: true, cwd: repoRoot },
  );

  const vars = {};
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/);
    if (m) vars[m[1]] = m[2];
  }

  if (!vars.DATABASE_URL) {
    throw new Error("Không tìm thấy DATABASE_URL trong env Preview của Vercel.");
  }

  // Vercel không trả lại giá trị của biến sensitive qua `env pull`, nên token
  // phải đến từ shell hoặc BLOB_READ_WRITE_TOKEN trong .env.local ở repo root.
  const token =
    process.env.BLOB_READ_WRITE_TOKEN || localEnv.BLOB_READ_WRITE_TOKEN || vars.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error(
      "Thiếu BLOB_READ_WRITE_TOKEN. Lấy token ở Vercel > Storage > Blob store > .env.local tab,\n" +
        "rồi đặt vào .env.local ở repo root hoặc export trước khi chạy script.",
    );
  }

  const host = vars.DATABASE_URL.match(/@([^/]+)\//)?.[1] ?? "(?)";
  console.log(`\n[audio-blob-test] Target DB: ${host}`);

  const script = process.env.AUDIO_BLOB_SCRIPT ?? "prisma/migrate-audio-to-blob.ts";
  execFileSync("npx", ["tsx", script, ...passthrough], {
    stdio: "inherit",
    shell: true,
    cwd: remixApp,
    env: {
      ...process.env,
      TARGET_DATABASE_URL: vars.DIRECT_URL ?? vars.DATABASE_URL,
      BLOB_READ_WRITE_TOKEN: token,
    },
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
