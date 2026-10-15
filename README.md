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

Để bật Azure AI Speech, điền thêm `AZURE_SPEECH_KEY` và `AZURE_SPEECH_REGION`
trong `remix-app/.env`. Khóa chỉ được dùng phía máy chủ. Trong ứng dụng, chọn
**Cài đặt → Giọng đọc → Azure AI Speech**. Azure dùng giọng Neural
`zh-CN-XiaoxiaoNeural` với style hội thoại `chat`; mức sử dụng có thể phát sinh phí.

```env
AZURE_SPEECH_KEY="khóa-tài-nguyên-speech"
AZURE_SPEECH_REGION="eastus"
```

Tạo resource Speech trong Azure Portal để lấy key và region. Xem thêm [tài liệu REST Text to Speech](https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech) và [danh sách ngôn ngữ/giọng đọc](https://learn.microsoft.com/azure/ai-services/speech-service/language-support?tabs=tts).

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
  Trên Windows, nếu `db push` báo `EPERM` khi ghi `query_engine-windows.dll.node` thì tắt dev server trước,
  hoặc chạy `npx prisma db push --skip-generate` rồi `npx prisma generate` sau.
- **Loader data**: React Router 7 serialize bằng turbo-stream, nên `Date` đi qua loader nguyên vẹn —
  không cần `.toISOString()` và không được khai báo type là `string`.
- **Bảng vàng giáo viên**: xếp hạng riêng theo khóa học và gộp học viên ở mọi lớp của khóa đó.
  Thời gian học chỉ cộng khi trang thuộc khóa học đang hiển thị và có hoạt động trong 2 phút gần nhất;
  một lượt truy cập mới được tính sau khi rời khóa hoặc không hoạt động ít nhất 30 phút.
  Dữ liệu bắt đầu được ghi nhận sau khi cập nhật schema, không có số liệu lịch sử.
- Xem thêm [AGENTS.md](AGENTS.md).
