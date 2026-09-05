// Đồng bộ schema lên DB trước khi build trên Vercel.
//
// Neon branch `test` được tạo copy-on-write từ `dev`, nên data có sẵn nhưng
// schema KHÔNG tự cập nhật khi `dev` đổi. Script này chạy `prisma db push`
// để branch test luôn khớp schema.prisma.
//
// Chỉ chạy trên preview. Production cần migration có kiểm soát, không push.
// Cố tình KHÔNG dùng --accept-data-loss: nếu thay đổi làm mất data, build sẽ
// fail để người deploy tự quyết, thay vì âm thầm xoá dữ liệu user đang test.

import { execFileSync } from "node:child_process";

const env = process.env.VERCEL_ENV;

if (env !== "preview") {
  console.log(`[sync-db] VERCEL_ENV=${env ?? "(local)"} — bỏ qua db push.`);
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("[sync-db] Thiếu DATABASE_URL.");
  process.exit(1);
}

console.log("[sync-db] preview — đang push schema lên Neon branch test…");

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
