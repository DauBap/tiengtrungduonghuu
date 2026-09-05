import type { Course } from "~/types/course";

export const mockCourses: Course[] = [
  { id: "hsk-1", code: "HSK-1", title: "HSK 1 - Beginner Chinese", description: "Khóa học nền tảng cho người mới bắt đầu học tiếng Trung.", hskLevel: 1, status: "PUBLISHED", order: 1, createdAt: "2024-01-10T00:00:00.000Z", updatedAt: "2024-01-20T00:00:00.000Z" },
  { id: "hsk-2", code: "HSK-2", title: "HSK 2 - Elementary Chinese", description: "Mở rộng từ vựng và ngữ pháp cơ bản cho học viên đang đi lên.", hskLevel: 2, status: "PUBLISHED", order: 2, createdAt: "2024-02-10T00:00:00.000Z", updatedAt: "2024-02-14T00:00:00.000Z" },
  { id: "hsk-3", code: "HSK-3", title: "HSK 3 - Intermediate Chinese", description: "Luyện kỹ năng đọc hiểu và giao tiếp theo ngữ cảnh thực tế.", hskLevel: 3, status: "PUBLISHED", order: 3, createdAt: "2024-03-05T00:00:00.000Z", updatedAt: "2024-03-25T00:00:00.000Z" },
  { id: "hsk-4", code: "HSK-4", title: "HSK 4 - Upper Intermediate", description: "Nâng cao khả năng sử dụng tiếng Trung trong môi trường học thuật.", hskLevel: 4, status: "DRAFT", order: 4, createdAt: "2024-04-08T00:00:00.000Z", updatedAt: "2024-04-10T00:00:00.000Z" },
  { id: "hsk-5", code: "HSK-5", title: "HSK 5 - Advanced Chinese", description: "Nâng cao từ vựng và khả năng viết đoạn văn phức tạp hơn.", hskLevel: 5, status: "ARCHIVED", order: 5, createdAt: "2023-11-18T00:00:00.000Z", updatedAt: "2024-01-12T00:00:00.000Z" },
  { id: "hsk-6", code: "HSK-6", title: "HSK 6 - Proficiency Chinese", description: "Khuôn khổ luyện thi và mở rộng kỹ năng tiếng Trung chuyên sâu.", hskLevel: 6, status: "PUBLISHED", order: 6, createdAt: "2024-04-12T00:00:00.000Z", updatedAt: "2024-04-22T00:00:00.000Z" },
];
