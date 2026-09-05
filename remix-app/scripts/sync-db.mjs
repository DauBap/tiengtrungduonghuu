// Đồng bộ schema lên DB trước khi build trên Vercel.
//
// Neon branch `test` được tạo copy-on-write từ `dev`, nên data có sẵn nhưng
// schema KHÔNG tự cập nhật khi `dev` đổi. Script này chạy `prisma db push`
// để branch test luôn khớp schema.prisma.
//
// Chỉ chạy cho preview của branch `test` — đó là môi trường duy nhất có
// env vars trỏ vào Neon branch test. Preview của branch khác (vd `dev`) không
// có DATABASE_URL nên phải bỏ qua, không được làm build fail.
//
// Cố tình KHÔNG dùng --accept-data-loss: nếu thay đổi làm mất data, build sẽ
// fail để người deploy tự quyết, thay vì âm thầm xoá dữ liệu user đang test.

import { execFileSync } from "node:child_process";

const SYNCED_BRANCH = "test";

const env = process.env.VERCEL_ENV;
const branch = process.env.VERCEL_GIT_COMMIT_REF;

if (env !== "preview") {
  console.log(`[sync-db] VERCEL_ENV=${env ?? "(local)"} — bỏ qua db push.`);
  process.exit(0);
}

if (branch !== SYNCED_BRANCH) {
  console.log(`[sync-db] branch=${branch ?? "(?)"} — chỉ sync '${SYNCED_BRANCH}', bỏ qua.`);
  process.exit(0);
}

// Tới đây là preview của branch test, phải có DATABASE_URL. Thiếu là cấu hình
// sai chứ không phải trường hợp bỏ qua được — fail để thấy ngay.
if (!process.env.DATABASE_URL) {
  console.error(
    `[sync-db] Preview branch '${SYNCED_BRANCH}' nhưng thiếu DATABASE_URL.\n` +
      "Kiểm tra Vercel → Settings → Environment Variables (scope Preview).",
  );
  process.exit(1);
}

console.log(`[sync-db] preview/${branch} — đang push schema lên Neon branch test…`);

try {
  // --skip-generate: postinstall đã chạy `prisma generate`.
  execFileSync("prisma", ["db", "push", "--skip-generate"], {
    stdio: "inherit",
    shell: true,
  });
  console.log("[sync-db] Schema đã khớp.");
} catch {
  console.error(
    "\n[sync-db] db push thất bại.\n" +
      "Nếu do thay đổi gây mất data, hãy chạy tay với --accept-data-loss\n" +
      "sau khi đã xác nhận data trên branch test bỏ được:\n" +
      "  npx prisma db push --accept-data-loss\n",
  );
  process.exit(1);
}
