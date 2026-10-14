# Danh sách đề thi thử

Thư mục này chỉ giữ các đề thi thử, không còn dữ liệu SBT. Mở
[manifest.csv](./manifest.csv) để xem ID, cấp độ, tên đề và tên tệp câu hỏi/audio.

| ID | Đề | Dữ liệu hiện có |
| --- | --- | --- |
| `hsk1_mock_test_01` | HSK1 - Đề thi thử số 1 | 40 câu, audio, ảnh |
| `hsk1_mock_test_02` | HSK1 - Đề thi thử số 2 | 40 câu, audio, ảnh |
| `hsk2_mock_test_01` | HSK2 - Đề thi thử số 1 | Chỉ có audio; source không có câu hỏi |

Mỗi bộ đề nằm trong thư mục theo ID. Tệp câu hỏi có hậu tố `_questions.json`,
audio có hậu tố `_audio.mp3`; ảnh nằm trong thư mục `images/`.

## Nhập vào database

Chạy `remix-app/prisma/migrate-mock-exams.ts` để kiểm tra dữ liệu trước; thêm
`--apply` để tải media lên Blob và nhập đề. Khi database có nhiều khóa cùng cấp,
có thể đặt `TARGET_COURSE_CODE` (ví dụ `HSK1-3.0`) để chọn khóa đích. Script sẽ
xác nhận cấp HSK của khóa và nhập đề ở trạng thái chưa phát hành.
