import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ─── Users ────────────────────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: { email: "admin@example.com", name: "Admin User", password: await bcrypt.hash("admin", 10), role: "admin" },
  });

  const teacher = await prisma.user.upsert({
    where: { email: "teacher@example.com" },
    update: {},
    create: { email: "teacher@example.com", name: "Teacher Zhang", password: await bcrypt.hash("123456", 10), role: "teacher" },
  });

  const student = await prisma.user.upsert({
    where: { email: "student@example.com" },
    update: {},
    create: { email: "student@example.com", name: "Student Li", password: await bcrypt.hash("123456", 10), role: "student" },
  });

  console.log("✅ Users seeded");

  // ─── Courses ──────────────────────────────────────────────────────────────
  const coursesData = [
    { code: "HSK-1", title: "HSK 1 - Beginner Chinese", description: "Khóa học nền tảng cho người mới bắt đầu học tiếng Trung.", hskLevel: 1, status: "PUBLISHED" as const, order: 1 },
    { code: "HSK-2", title: "HSK 2 - Elementary Chinese", description: "Mở rộng từ vựng và ngữ pháp cơ bản cho học viên đang đi lên.", hskLevel: 2, status: "PUBLISHED" as const, order: 2 },
    { code: "HSK-3", title: "HSK 3 - Intermediate Chinese", description: "Luyện kỹ năng đọc hiểu và giao tiếp theo ngữ cảnh thực tế.", hskLevel: 3, status: "PUBLISHED" as const, order: 3 },
    { code: "HSK-4", title: "HSK 4 - Upper Intermediate", description: "Nâng cao khả năng sử dụng tiếng Trung trong môi trường học thuật.", hskLevel: 4, status: "DRAFT" as const, order: 4 },
    { code: "HSK-5", title: "HSK 5 - Advanced Chinese", description: "Nâng cao từ vựng và khả năng viết đoạn văn phức tạp hơn.", hskLevel: 5, status: "ARCHIVED" as const, order: 5 },
    { code: "HSK-6", title: "HSK 6 - Proficiency Chinese", description: "Khuôn khổ luyện thi và mở rộng kỹ năng tiếng Trung chuyên sâu.", hskLevel: 6, status: "PUBLISHED" as const, order: 6 },
  ];

  const courses: Record<string, { id: string }> = {};
  for (const c of coursesData) {
    const course = await prisma.course.upsert({
      where: { code: c.code },
      update: { title: c.title, description: c.description, status: c.status },
      create: c,
    });
    courses[c.code] = course;
  }

  console.log("✅ Courses seeded");

  // ─── Lessons ──────────────────────────────────────────────────────────────
  const lessonsData = [
    {
      courseCode: "HSK-1", order: 1, title: "Chào hỏi & Giới thiệu", subtitle: "你好，你叫什么名字？",
      vocab: [
        { chinese: "你好", pinyin: "nǐ hǎo", translation: "Xin chào", wordType: "PHRASE" as const, order: 1 },
        { chinese: "你叫什么名字？", pinyin: "nǐ jiào shénme míngzi?", translation: "Bạn tên là gì?", wordType: "PHRASE" as const, order: 2 },
        { chinese: "我叫", pinyin: "wǒ jiào", translation: "Tôi tên là", wordType: "PHRASE" as const, order: 3 },
        { chinese: "再见", pinyin: "zàijiàn", translation: "Tạm biệt", wordType: "PHRASE" as const, order: 4 },
        { chinese: "谢谢", pinyin: "xièxie", translation: "Cảm ơn", wordType: "VERB" as const, order: 5 },
      ],
    },
    {
      courseCode: "HSK-1", order: 2, title: "Gia đình", subtitle: "我的家人",
      vocab: [
        { chinese: "爸爸", pinyin: "bàba", translation: "Bố", wordType: "NOUN" as const, order: 1 },
        { chinese: "妈妈", pinyin: "māma", translation: "Mẹ", wordType: "NOUN" as const, order: 2 },
        { chinese: "哥哥", pinyin: "gēge", translation: "Anh trai", wordType: "NOUN" as const, order: 3 },
        { chinese: "姐姐", pinyin: "jiějie", translation: "Chị gái", wordType: "NOUN" as const, order: 4 },
        { chinese: "弟弟", pinyin: "dìdi", translation: "Em trai", wordType: "NOUN" as const, order: 5 },
        { chinese: "妹妹", pinyin: "mèimei", translation: "Em gái", wordType: "NOUN" as const, order: 6 },
      ],
    },
    {
      courseCode: "HSK-1", order: 3, title: "Hoạt động hàng ngày", subtitle: "日常生活",
      vocab: [
        { chinese: "吃饭", pinyin: "chīfàn", translation: "Ăn cơm", wordType: "VERB" as const, order: 1 },
        { chinese: "睡觉", pinyin: "shuìjiào", translation: "Ngủ", wordType: "VERB" as const, order: 2 },
        { chinese: "工作", pinyin: "gōngzuò", translation: "Làm việc", wordType: "VERB" as const, order: 3 },
        { chinese: "学习", pinyin: "xuéxí", translation: "Học tập", wordType: "VERB" as const, order: 4 },
      ],
    },
    {
      courseCode: "HSK-1", order: 4, title: "Số đếm & Thời gian", subtitle: "数字和时间",
      vocab: [
        { chinese: "一", pinyin: "yī", translation: "Một", wordType: "NUMERAL" as const, order: 1 },
        { chinese: "二", pinyin: "èr", translation: "Hai", wordType: "NUMERAL" as const, order: 2 },
        { chinese: "三", pinyin: "sān", translation: "Ba", wordType: "NUMERAL" as const, order: 3 },
        { chinese: "现在几点？", pinyin: "xiànzài jǐ diǎn?", translation: "Bây giờ mấy giờ?", wordType: "PHRASE" as const, order: 4 },
      ],
    },
    {
      courseCode: "HSK-2", order: 1, title: "Mua sắm", subtitle: "买东西",
      vocab: [
        { chinese: "这个多少钱？", pinyin: "zhège duōshǎo qián?", translation: "Cái này bao nhiêu tiền?", wordType: "PHRASE" as const, order: 1 },
        { chinese: "太贵了", pinyin: "tài guì le", translation: "Đắt quá", wordType: "PHRASE" as const, order: 2 },
        { chinese: "便宜", pinyin: "piányi", translation: "Rẻ", wordType: "ADJECTIVE" as const, order: 3 },
      ],
    },
    {
      courseCode: "HSK-2", order: 2, title: "Thời tiết", subtitle: "天气",
      vocab: [
        { chinese: "今天天气很好", pinyin: "jīntiān tiānqì hěn hǎo", translation: "Hôm nay thời tiết đẹp", wordType: "PHRASE" as const, order: 1 },
        { chinese: "下雨", pinyin: "xiàyǔ", translation: "Mưa", wordType: "VERB" as const, order: 2 },
        { chinese: "冷", pinyin: "lěng", translation: "Lạnh", wordType: "ADJECTIVE" as const, order: 3 },
      ],
    },
  ];

  for (const l of lessonsData) {
    const courseId = courses[l.courseCode].id;
    // upsert lesson by courseId + order
    const existing = await prisma.lesson.findFirst({ where: { courseId, order: l.order } });
    const lesson = existing
      ? await prisma.lesson.update({ where: { id: existing.id }, data: { title: l.title, subtitle: l.subtitle } })
      : await prisma.lesson.create({ data: { courseId, order: l.order, title: l.title, subtitle: l.subtitle } });

    // delete + recreate vocab for idempotency
    await prisma.vocabItem.deleteMany({ where: { lessonId: lesson.id } });
    const vocabItems = await Promise.all(
      l.vocab.map((v) => prisma.vocabItem.create({ data: { ...v, lessonId: lesson.id } }))
    );

    // learning blocks: 1 flashcard dùng toàn bộ từ vựng của bài
    await prisma.learningBlock.deleteMany({ where: { lessonId: lesson.id } });
    await prisma.learningBlock.create({
      data: {
        lessonId: lesson.id,
        type: "FLASHCARD",
        title: "Flashcard từ vựng",
        description: "Lật thẻ để ghi nhớ từ vựng của bài.",
        order: 1,
        required: true,
        config: {
          vocabItemIds: vocabItems.map((v) => v.id),
          frontSide: "chinese",
          showPinyinOnFront: false,
          shuffle: false,
          autoSpeak: false,
        },
      },
    });

    // exercise & test
    await prisma.exercise.upsert({
      where: { lessonId: lesson.id },
      update: {},
      create: { lessonId: lesson.id, title: `Bài tập - ${l.title}` },
    });
    await prisma.test.upsert({
      where: { lessonId: lesson.id },
      update: {},
      create: { lessonId: lesson.id, title: `Kiểm tra - ${l.title}` },
    });
  }

  console.log("✅ Lessons + vocab + flashcards + exercises + tests seeded");

  // ─── Enrollments ──────────────────────────────────────────────────────────
  for (const code of ["HSK-1", "HSK-2"]) {
    const courseId = courses[code].id;
    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: student.id, courseId } },
      update: {},
      create: { userId: student.id, courseId },
    });
  }

  for (const code of ["HSK-1", "HSK-2", "HSK-3"]) {
    const courseId = courses[code].id;
    await prisma.enrollment.upsert({
      where: { userId_courseId: { userId: teacher.id, courseId } },
      update: {},
      create: { userId: teacher.id, courseId },
    });
  }

  console.log("✅ Enrollments seeded");
  console.log("\n📋 Tài khoản:");
  console.log("   admin:   admin@example.com / admin");
  console.log("   teacher: teacher@example.com / 123456");
  console.log("   student: student@example.com / 123456");
}

main().catch(console.error).finally(() => prisma.$disconnect());
