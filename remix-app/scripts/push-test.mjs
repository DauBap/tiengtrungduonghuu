// Push schema lên Neon branch `test` từ máy local.
//
// Lấy connection string trực tiếp từ Vercel (scope Preview / branch test) nên
// không cần copy tay và không lưu secret vào repo. File tạm luôn được xoá.
//
// Dùng khi muốn đồng bộ schema ngay mà không đợi deploy:
//   npm run db:push:test
//   npm run db:push:test -- --accept-data-loss

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Link Vercel (.vercel/project.json) nằm ở repo root, không phải trong remix-app,
// nên `vercel env pull` phải chạy với cwd là root.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const passthrough = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), "push-test-"));
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

  const host = vars.DATABASE_URL.match(/@([^/]+)\//)?.[1] ?? "(?)";
  console.log(`\n[push-test] Target: ${host}`);

  execFileSync("prisma", ["db", "push", "--skip-generate", ...passthrough], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      DATABASE_URL: vars.DATABASE_URL,
      DIRECT_URL: vars.DIRECT_URL ?? vars.DATABASE_URL,
    },
  });
} finally {
  rmSync(dir, { recursive: true, force: true });
}
