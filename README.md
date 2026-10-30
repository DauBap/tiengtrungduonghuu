# Tiếng Trung Dương Hữu

Nền tảng học tiếng Trung theo cấp độ HSK: khóa học → bài học → lý thuyết → bài tập → kiểm tra,
với 3 vai trò admin / giáo viên / học viên.

Ứng dụng nằm trong [remix-app/](remix-app/) (React Router 7 framework mode + Prisma + PostgreSQL).
Thư mục gốc chỉ chứa tài liệu và cấu hình chung.

## Bắt đầu

```bash
cd remix-app
npm install
cp .env.example .env      # điền DATABASE_URL, DIRECT_URL, SESSION_SECRET
npx prisma db push        # dự án chưa có migration history — dùng db push
npm run seed
npm run dev               # http://localhost:5173
```

Tài khoản sau khi seed:

| Vai trò | Email | Mật khẩu |
|---|---|---|
| Admin | `admin@example.com` | `admin` |
| Giáo viên | `teacher@example.com` | `1234` |
| Học viên | `student@example.com` | `1234` |

## Scripts

Chạy trong `remix-app/`:

| Lệnh | Việc |
|---|---|
| `npm run dev` | Dev server (Vite + HMR) |
| `npm run build` | Build production |
| `npm start` | Chạy bản build |
| `npm run typecheck` | `tsc` — phải sạch trước khi commit |
| `npm run seed` | Nạp dữ liệu mẫu (idempotent) |

## Database production

Production dùng PostgreSQL chạy trực tiếp trên Ubuntu, trong database
`tiengtrungduonghuu`. Ứng dụng trên server đọc `DATABASE_URL` và `DIRECT_URL`
từ file môi trường riêng tại
`/home/baotn/apps/tiengtrungduonghuu/remix-app/.env`; cả hai URL trỏ tới
PostgreSQL trên `127.0.0.1:5432`. Không đưa thông tin xác thực production vào Git.
`.env.example` chỉ là cấu hình mẫu cho PostgreSQL dùng khi phát triển local.

## Cảnh báo server mất kết nối qua Telegram

GitHub Actions kiểm tra `https://tiengtrungduonghuu.edu.vn/` mỗi 5 phút và chỉ gửi Telegram khi server chuyển trạng thái online/offline. Lần kiểm tra đầu tiên gửi trạng thái ban đầu. Workflow cần hai repository secrets, không lưu token trong Git:

1. Vào **Settings → Secrets and variables → Actions → New repository secret**.
2. Tạo `TELEGRAM_BOT_TOKEN` với token bot đang lưu trong `~/.config/tiengtrungduonghuu/telegram.env` trên Linux.
3. Tạo `TELEGRAM_CHAT_ID` với chat ID Telegram đã cấu hình trên Linux.
4. Trong **Settings → Actions → General → Workflow permissions**, cho phép workflow có quyền đọc và ghi repository actions/variables nếu cài đặt repository yêu cầu.
5. Sau khi push workflow lên nhánh mặc định, mở **Actions → Server uptime monitor → Run workflow** để chạy thử.

Workflow lưu trạng thái lần kiểm tra trước trong GitHub Actions cache để chỉ gửi tin khi trạng thái thay đổi; không cần token GitHub bổ sung hay quyền ghi repository. Cảnh báo được phát hiện trong tối đa khoảng 5 phút cộng thời gian GitHub Actions khởi chạy; lịch chạy GitHub có thể trễ khi hệ thống bận. Nếu app không có URL công khai thì cần một thiết bị giám sát khác bên ngoài server.

## MeloTTS trên server

Ứng dụng có thể dùng MeloTTS chạy CPU trên Ubuntu qua service nội bộ tại
`127.0.0.1:8766`; WAV được tạo lần đầu rồi cache trên ổ đĩa server để dùng lại,
còn PostgreSQL lưu metadata và đường dẫn. Nếu service lỗi, trình duyệt tự dùng
giọng tiếng Trung có sẵn. Hướng dẫn cài Python 3.9 trong virtual environment
riêng, tải model và chạy systemd user service nằm trong
[remix-app/local-tts/README.md](remix-app/local-tts/README.md).

### Tra cứu số học viên online bằng `/status`

Bot hiện có thể trả lời lệnh `/status` trong chat Telegram đã cấu hình ở `TELEGRAM_CHAT_ID`. Số online là số học viên đang hoạt động, chưa bị xóa, có phiên học khóa học chưa kết thúc và heartbeat trong 2 phút gần nhất. Webhook chỉ xử lý đúng chat đã cho phép và yêu cầu header bí mật của Telegram.

1. Tạo `TELEGRAM_WEBHOOK_SECRET` trên Ubuntu bằng `openssl rand -hex 32`; thêm biến này vào `~/.config/tiengtrungduonghuu/telegram.env` cùng `TELEGRAM_BOT_TOKEN` và `TELEGRAM_CHAT_ID`, đồng thời bảo đảm service app nạp file môi trường đó. Không commit hoặc gửi các giá trị này qua chat.
2. Deploy ứng dụng có route `/telegram/status` và khởi động lại service để nạp biến môi trường.
3. Trong shell Ubuntu đã đăng nhập, nạp cấu hình bot hiện có rồi đăng ký webhook. Thay URL nếu app production dùng domain khác:

   ```bash
   set -a
   . ~/.config/tiengtrungduonghuu/telegram.env
   set +a
   curl --fail-with-body --silent --show-error \
     --request POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     --data-urlencode "url=https://tiengtrungduonghuu.edu.vn/telegram/status" \
     --data-urlencode "secret_token=${TELEGRAM_WEBHOOK_SECRET}" \
     --data-urlencode 'allowed_updates=["message"]'
   ```

4. Gửi `/status` trong chat được cấu hình. Telegram sẽ trả số học viên đang online.

Webhook của bot chỉ có thể trỏ tới một endpoint tại một thời điểm. Nếu bot này đã nhận update qua webhook/polling khác, hãy chuyển handler đó sang cùng endpoint trước khi chạy `setWebhook`.

## Cấu trúc

```
remix-app/
├── app/
│   ├── routes/            # file-based routes, khai báo trong app/routes.ts
│   ├── components/
│   │   ├── ui/            # primitive (shadcn-style)
│   │   ├── common/        # EmptyState, Overlay, StatCard...
│   │   ├── layout/        # AppShell, sidebar theo vai trò
│   │   └── lessons/blocks/# renderer cho từng dạng bài học lý thuyết
│   ├── lib/
│   │   ├── db.server.ts       # mọi truy vấn Prisma + logic tiến độ
│   │   ├── session.server.ts  # cookie session, requireRole
│   │   ├── learning-blocks.ts # zod schema + metadata các dạng bài học
│   │   ├── word-types.ts      # từ loại (danh từ, động từ...)
│   │   └── speech.ts          # TTS tiếng Trung (Web Speech API)
│   └── types/
└── prisma/                # schema.prisma + seed.ts
```

## Ghi chú

- **Dạng bài học lý thuyết**: mỗi bài gồm nhiều `LearningBlock`, cấu hình riêng lưu ở cột `config Json`
  và validate bằng zod. Hiện chỉ **Flashcard** hoạt động; Nghe câu / Từ vựng / Ngữ pháp đang là mục
  disable "Sắp có" ở trang admin.
- **Migration**: dự án không có migration history, dùng `prisma db push`. `migrate dev` sẽ yêu cầu reset DB.
  Khi cập nhật phiên bản có thay đổi `prisma/schema.prisma`, hãy chạy `npx prisma db push` trong `remix-app/`
  để tạo/cập nhật bảng trước khi khởi động ứng dụng.
  Trên Windows, nếu `db push` báo `EPERM` khi ghi `query_engine-windows.dll.node` thì tắt dev server trước,
  hoặc chạy `npx prisma db push --skip-generate` rồi `npx prisma generate` sau.
- **Loader data**: React Router 7 serialize bằng turbo-stream, nên `Date` đi qua loader nguyên vẹn —
  không cần `.toISOString()` và không được khai báo type là `string`.
- **Bảng vàng giáo viên**: xếp hạng riêng theo khóa học và gộp học viên ở mọi lớp của khóa đó.
  Thời gian học chỉ cộng khi trang thuộc khóa học đang hiển thị và có hoạt động trong 2 phút gần nhất;
  một lượt truy cập mới được tính sau khi rời khóa hoặc không hoạt động ít nhất 30 phút.
  Dữ liệu bắt đầu được ghi nhận sau khi cập nhật schema, không có số liệu lịch sử.
- Xem thêm [AGENTS.md](AGENTS.md).
