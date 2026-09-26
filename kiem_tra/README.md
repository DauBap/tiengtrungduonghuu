# Dữ liệu tab Bài thi

Mỗi file JSON chứa dữ liệu một khóa học, các bài học và toàn bộ từ vựng làm nguồn cho tab **Thi tổng hợp**.

| Tệp | Khóa học | Số bài | Số từ |
|---|---|---:|---:|
| `hsk1_2.json` | HSK 1 (2.0) | 15 | 170 |
| `hsk1_3_0.json` | HSK 1 (3.0) | 15 | 331 |
| `hsk2_2_0.json` | HSK 2 (2.0) | 15 | 173 |
| `hsk2_3_0.json` | HSK 2 (3.0) | 15 | 212 |
| `hsk3_2_0.json` | HSK 3 (2.0) | 18 | 286 |
| `hsk3_3_0.json` | HSK 3 (3.0) | 18 | 486 |
| `hsk4_2_0.json` | HSK 4 (2.0) | 20 | 621 |
| `hsk5_2_0.json` | HSK 5 (2.0) | 36 | 1,367 |

Tổng cộng: 8 khóa, 152 bài học và 3.646 mục từ vựng.

## Cách tạo đề

Học viên chọn một hoặc nhiều bài học; đề lấy từ trường `vocabulary` của các bài đã chọn. Tab hỗ trợ các chế độ Trung → Việt, Việt → Trung và hỗn hợp. Đề ngắn có `floor(tổng_số_từ / 3)` câu, đề vừa có `floor(tổng_số_từ * 2 / 3)` câu, đề đầy đủ có toàn bộ số từ đã chọn. Bộ chọn độ dài hiện khi có ít nhất 20 từ.

Câu hỏi và phương án nhiễu được tạo ngẫu nhiên lúc bắt đầu thi. Vì vậy, các tệp này giữ dữ liệu từ vựng nguồn, không tạo bộ đề hay đáp án tĩnh.