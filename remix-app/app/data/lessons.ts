import type { Lesson, Exercise, Test } from "~/types/lesson";

export const mockLessons: Lesson[] = [
  { id: "hsk1-l1", courseId: "hsk-1", order: 1, title: "Chào hỏi & Giới thiệu", subtitle: "你好，你叫什么名字？", content: [{ chinese: "你好", pinyin: "nǐ hǎo", translation: "Xin chào" }, { chinese: "你叫什么名字？", pinyin: "nǐ jiào shénme míngzi?", translation: "Bạn tên là gì?" }, { chinese: "我叫", pinyin: "wǒ jiào", translation: "Tôi tên là" }, { chinese: "再见", pinyin: "zàijiàn", translation: "Tạm biệt" }, { chinese: "谢谢", pinyin: "xièxie", translation: "Cảm ơn" }] },
  { id: "hsk1-l2", courseId: "hsk-1", order: 2, title: "Gia đình", subtitle: "我的家人", content: [{ chinese: "爸爸", pinyin: "bàba", translation: "Bố" }, { chinese: "妈妈", pinyin: "māma", translation: "Mẹ" }, { chinese: "哥哥", pinyin: "gēge", translation: "Anh trai" }, { chinese: "姐姐", pinyin: "jiějie", translation: "Chị gái" }] },
  { id: "hsk1-l3", courseId: "hsk-1", order: 3, title: "Hoạt động hàng ngày", subtitle: "日常生活", content: [{ chinese: "吃饭", pinyin: "chīfàn", translation: "Ăn cơm" }, { chinese: "睡觉", pinyin: "shuìjiào", translation: "Ngủ" }, { chinese: "工作", pinyin: "gōngzuò", translation: "Làm việc" }, { chinese: "学习", pinyin: "xuéxí", translation: "Học tập" }] },
  { id: "hsk1-l4", courseId: "hsk-1", order: 4, title: "Số đếm & Thời gian", subtitle: "数字和时间", content: [{ chinese: "一", pinyin: "yī", translation: "Một" }, { chinese: "二", pinyin: "èr", translation: "Hai" }, { chinese: "三", pinyin: "sān", translation: "Ba" }, { chinese: "现在几点？", pinyin: "xiànzài jǐ diǎn?", translation: "Bây giờ mấy giờ?" }] },
  { id: "hsk2-l1", courseId: "hsk-2", order: 1, title: "Mua sắm", subtitle: "买东西", content: [{ chinese: "这个多少钱？", pinyin: "zhège duōshǎo qián?", translation: "Cái này bao nhiêu tiền?" }, { chinese: "太贵了", pinyin: "tài guì le", translation: "Đắt quá" }, { chinese: "便宜", pinyin: "piányi", translation: "Rẻ" }] },
  { id: "hsk2-l2", courseId: "hsk-2", order: 2, title: "Thời tiết", subtitle: "天气", content: [{ chinese: "今天天气很好", pinyin: "jīntiān tiānqì hěn hǎo", translation: "Hôm nay thời tiết đẹp" }, { chinese: "下雨", pinyin: "xiàyǔ", translation: "Mưa" }, { chinese: "冷", pinyin: "lěng", translation: "Lạnh" }] },
];

export const mockExercises: Exercise[] = [
  { id: "hsk1-l1-ex", lessonId: "hsk1-l1", title: "Bài tập 1" },
  { id: "hsk1-l2-ex", lessonId: "hsk1-l2", title: "Bài tập 2" },
  { id: "hsk1-l3-ex", lessonId: "hsk1-l3", title: "Bài tập 3" },
  { id: "hsk1-l4-ex", lessonId: "hsk1-l4", title: "Bài tập 4" },
  { id: "hsk2-l1-ex", lessonId: "hsk2-l1", title: "Bài tập 1" },
  { id: "hsk2-l2-ex", lessonId: "hsk2-l2", title: "Bài tập 2" },
];

export const mockTests: Test[] = [
  { id: "hsk1-l1-test", lessonId: "hsk1-l1", title: "Kiểm tra 1" },
  { id: "hsk1-l2-test", lessonId: "hsk1-l2", title: "Kiểm tra 2" },
  { id: "hsk1-l3-test", lessonId: "hsk1-l3", title: "Kiểm tra 3" },
  { id: "hsk1-l4-test", lessonId: "hsk1-l4", title: "Kiểm tra 4" },
  { id: "hsk2-l1-test", lessonId: "hsk2-l1", title: "Kiểm tra 1" },
  { id: "hsk2-l2-test", lessonId: "hsk2-l2", title: "Kiểm tra 2" },
];

export const teacherCourseIds = ["hsk-1", "hsk-2", "hsk-3"];
export const studentCourseIds = ["hsk-1", "hsk-2"];
