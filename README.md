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
| Giáo viên | `teacher@example.com` | `123456` |
| Học viên | `student@example.com` | `123456` |

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
- Xem thêm [AGENTS.md](AGENTS.md).
