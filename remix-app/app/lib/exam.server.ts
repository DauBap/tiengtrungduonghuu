/**
 * Đề thi — CRUD và vòng đời version.
 *
 * Ba luật giữ cho lịch sử thi bất biến, mọi route phải đi qua đây:
 *
 *  1. `getEditableVersion()` là cửa duy nhất để lấy version đem sửa. Version
 *     hiện tại đã PUBLISHED thì nó tạo bản nháp mới (sao chép phần + câu) chứ
 *     không sửa đè — lượt thi cũ trỏ vào version cũ nên không đổi nghĩa.
 *  2. `publishVersion()` ghi `ExamQuestion.snapshot` cho từng câu. Sau đó đề
 *     render và chấm chỉ đọc snapshot, nên admin sửa câu trong kho hay xóa mềm
 *     câu đó cũng không làm sai đề đã phát hành.
 *  3. Không xóa version đã có lượt thi. Muốn dừng thì ARCHIVED.
 */
import { prisma } from "~/lib/prisma.server";
import { DEFAULT_EXAM_SETTINGS, readExamSettings } from "~/lib/exams";
import type { QuestionSnapshot } from "~/lib/exam-grading";
import type { Prisma } from "@prisma/client";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string; field?: string };

// ─── Đọc ─────────────────────────────────────────────────────────────────────

export async function listExamsForAdmin() {
  const exams = await prisma.exam.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      lesson: { select: { id: true, title: true, order: true } },
      course: { select: { id: true, title: true } },
      versions: {
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          status: true,
          publishedAt: true,
          _count: { select: { items: true, sections: true, attempts: true } },
        },
      },
    },
  });

  // Bản nháp đang soạn và bản đang chạy là hai thứ khác nhau, admin cần thấy cả hai
  return exams.map((exam) => ({
    ...exam,
    latestVersion: exam.versions[0] ?? null,
    publishedVersion: exam.versions.find((v) => v.status === "PUBLISHED") ?? null,
    draftVersion: exam.versions.find((v) => v.status === "DRAFT") ?? null,
    attemptCount: exam.versions.reduce((sum, v) => sum + v._count.attempts, 0),
  }));
}

const versionInclude = {
  sections: { orderBy: { order: "asc" } },
  _count: { select: { items: true, attempts: true } },
} as const;

export async function getExamForAdmin(examId: string) {
  return prisma.exam.findUnique({
    where: { id: examId },
    include: {
      lesson: { select: { id: true, title: true, order: true, courseId: true } },
      course: { select: { id: true, title: true } },
      createdBy: { select: { id: true, name: true } },
      versions: { orderBy: { version: "desc" }, include: versionInclude },
      accessRules: true,
    },
  });
}

/** Version đang chạy cho học viên. Nhiều bản PUBLISHED thì lấy bản mới nhất. */
export async function getPublishedVersion(examId: string) {
  return prisma.examVersion.findFirst({
    where: { examId, status: "PUBLISHED" },
    orderBy: { version: "desc" },
    include: versionInclude,
  });
}

// ─── Tạo / sửa đề ────────────────────────────────────────────────────────────

export interface ExamInput {
  code: string;
  title: string;
  description: string | null;
  lessonId: string | null;
  courseId: string | null;
}

export function validateExamInput(input: ExamInput): Result<ExamInput> {
  if (!input.code.trim()) return { ok: false, error: "Vui lòng nhập mã đề", field: "code" };
  if (!/^[A-Za-z0-9_-]+$/.test(input.code.trim())) {
    return {
      ok: false,
      error: "Mã đề chỉ gồm chữ không dấu, số, gạch ngang và gạch dưới",
      field: "code",
    };
  }
  if (!input.title.trim()) return { ok: false, error: "Vui lòng nhập tên đề", field: "title" };
  return { ok: true, data: input };
}

/**
 * Tạo đề kèm luôn version 1 ở trạng thái nháp.
 *
 * Đề không có version thì mọi tab sau (cấu trúc, câu hỏi, cài đặt) đều không có
 * chỗ để ghi, nên tạo sẵn trong cùng transaction thay vì tạo lười ở tab đầu tiên.
 */
export async function createExam(input: ExamInput, createdById: string) {
  const valid = validateExamInput(input);
  if (!valid.ok) return valid;

  const code = input.code.trim();
  if (await prisma.exam.findUnique({ where: { code }, select: { id: true } })) {
    return { ok: false as const, error: "Mã đề này đã tồn tại", field: "code" };
  }

  const exam = await prisma.exam.create({
    data: {
      code,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      lessonId: input.lessonId,
      courseId: input.courseId,
      createdById,
      status: "DRAFT",
      versions: {
        create: { version: 1, status: "DRAFT", settings: DEFAULT_EXAM_SETTINGS as object },
      },
    },
  });
  return { ok: true as const, data: exam };
}

export async function updateExam(examId: string, input: ExamInput) {
  const valid = validateExamInput(input);
  if (!valid.ok) return valid;

  const code = input.code.trim();
  const clash = await prisma.exam.findUnique({ where: { code }, select: { id: true } });
  if (clash && clash.id !== examId) {
    return { ok: false as const, error: "Mã đề này đã tồn tại", field: "code" };
  }

  const updated = await prisma.exam.updateMany({
    where: { id: examId },
    data: {
      code,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      lessonId: input.lessonId,
      courseId: input.courseId,
    },
  });
  if (updated.count === 0) return { ok: false as const, error: "Không tìm thấy đề thi" };
  return { ok: true as const, data: { id: examId } };
}

/**
 * Xóa đề.
 *
 * Có lượt thi rồi thì không xóa — xóa là mất luôn bài làm và điểm của học viên.
 * Trường hợp đó admin phải lưu trữ (ARCHIVED) để gỡ khỏi danh sách thi.
 */
export async function deleteExam(examId: string) {
  const attempts = await prisma.examAttempt.count({ where: { version: { examId } } });
  if (attempts > 0) {
    return {
      ok: false as const,
      error:
        `Đề này đã có ${attempts} lượt thi nên không xóa được — xóa sẽ mất bài làm và điểm ` +
        "của học viên. Hãy chuyển đề sang trạng thái lưu trữ.",
    };
  }
  const deleted = await prisma.exam.deleteMany({ where: { id: examId } });
  if (deleted.count === 0) return { ok: false as const, error: "Không tìm thấy đề thi" };
  return { ok: true as const, data: { id: examId } };
}

/** Đổi trạng thái vỏ đề (nháp / phát hành / lưu trữ). */
export async function setExamStatus(examId: string, status: "DRAFT" | "PUBLISHED" | "ARCHIVED") {
  const updated = await prisma.exam.updateMany({ where: { id: examId }, data: { status } });
  if (updated.count === 0) return { ok: false as const, error: "Không tìm thấy đề thi" };
  return { ok: true as const, data: { id: examId } };
}

// ─── Version ─────────────────────────────────────────────────────────────────

/**
 * Lấy version để sửa; tự tạo bản nháp mới nếu cần.
 *
 * - Đang có bản nháp → dùng luôn bản đó.
 * - Chỉ có bản đã publish → sao chép thành version kế tiếp (phần, câu, điểm,
 *   setting giữ nguyên; `snapshot` bỏ đi vì bản nháp đọc câu hỏi live từ kho).
 * - Chưa có version nào (dữ liệu cũ) → tạo version 1.
 */
export async function getEditableVersion(examId: string) {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!exam) return { ok: false as const, error: "Không tìm thấy đề thi" };

  const latest = exam.versions[0];

  if (!latest) {
    const created = await prisma.examVersion.create({
      data: { examId, version: 1, status: "DRAFT", settings: DEFAULT_EXAM_SETTINGS as object },
      include: versionInclude,
    });
    return { ok: true as const, data: created, createdNew: true };
  }

  if (latest.status === "DRAFT") {
    const full = await prisma.examVersion.findUnique({
      where: { id: latest.id },
      include: versionInclude,
    });
    return { ok: true as const, data: full!, createdNew: false };
  }

  const cloned = await cloneVersion(latest.id);
  if (!cloned.ok) return cloned;
  return { ok: true as const, data: cloned.data, createdNew: true };
}

/**
 * Sao chép một version thành bản nháp kế tiếp.
 *
 * Id của phần đổi hết nên `ExamQuestion.sectionId` phải map lại theo id mới —
 * quên bước này là câu hỏi trỏ sang phần của version cũ.
 */
export async function cloneVersion(sourceVersionId: string) {
  const source = await prisma.examVersion.findUnique({
    where: { id: sourceVersionId },
    include: {
      sections: { orderBy: { order: "asc" } },
      items: { orderBy: { order: "asc" } },
    },
  });
  if (!source) return { ok: false as const, error: "Không tìm thấy phiên bản đề" };

  const last = await prisma.examVersion.findFirst({
    where: { examId: source.examId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const nextNumber = (last?.version ?? 0) + 1;

  const created = await prisma.$transaction(async (tx) => {
    const version = await tx.examVersion.create({
      data: {
        examId: source.examId,
        version: nextNumber,
        status: "DRAFT",
        settings: source.settings as Prisma.InputJsonValue,
      },
    });

    const sectionIdMap = new Map<string, string>();
    for (const section of source.sections) {
      const copy = await tx.examSection.create({
        data: {
          examVersionId: version.id,
          title: section.title,
          description: section.description,
          order: section.order,
          settings: section.settings as Prisma.InputJsonValue,
        },
      });
      sectionIdMap.set(section.id, copy.id);
    }

    for (const item of source.items) {
      const sectionId = sectionIdMap.get(item.sectionId);
      if (!sectionId) continue; // câu mồ côi ở bản gốc thì bỏ, không nhân bản lỗi
      await tx.examQuestion.create({
        data: {
          examVersionId: version.id,
          sectionId,
          questionId: item.questionId,
          order: item.order,
          points: item.points,
          required: item.required,
          settings: item.settings as Prisma.InputJsonValue,
          // snapshot chỉ sinh lúc publish; bản nháp đọc câu hỏi live từ kho
          snapshot: undefined,
        },
      });
    }

    return version;
  });

  const full = await prisma.examVersion.findUnique({
    where: { id: created.id },
    include: versionInclude,
  });
  return { ok: true as const, data: full! };
}

/**
 * Phát hành một version: đóng băng nội dung từng câu vào `snapshot`.
 *
 * Đây là chỗ duy nhất ghi snapshot. Sau khi publish, đề không còn phụ thuộc
 * bảng `Question` nữa — sửa hay xóa câu trong kho đều không đụng tới đề này.
 */
export async function publishVersion(versionId: string) {
  const version = await prisma.examVersion.findUnique({
    where: { id: versionId },
    include: {
      sections: { select: { id: true } },
      items: {
        include: {
          question: { include: { options: { orderBy: { order: "asc" } } } },
        },
      },
    },
  });
  if (!version) return { ok: false as const, error: "Không tìm thấy phiên bản đề" };
  if (version.status === "PUBLISHED") {
    return { ok: false as const, error: "Phiên bản này đã được phát hành" };
  }
  if (version.sections.length === 0) {
    return { ok: false as const, error: "Đề chưa có phần nào — thêm ở tab Cấu trúc trước" };
  }
  if (version.items.length === 0) {
    return { ok: false as const, error: "Đề chưa có câu hỏi nào — thêm ở tab Câu hỏi trước" };
  }

  // Câu đã bị xóa mềm khỏi kho vẫn publish được: nội dung nằm trong snapshot.
  // Nhưng câu không có đáp án đúng thì chấm kiểu gì cũng sai, chặn từ đây.
  const broken = version.items.filter(
    (item) =>
      item.question.options.length > 0 && !item.question.options.some((o) => o.isCorrect)
  );
  if (broken.length > 0) {
    return {
      ok: false as const,
      error: `Có ${broken.length} câu chưa đánh dấu đáp án đúng, không thể phát hành.`,
    };
  }

  await prisma.$transaction(async (tx) => {
    for (const item of version.items) {
      const snapshot: QuestionSnapshot = {
        questionId: item.question.id,
        type: item.question.type,
        prompt: item.question.prompt,
        explanation: item.question.explanation,
        payload: readSnapshotPayload(item.question.payload),
        options: item.question.options.map((o) => ({
          id: o.id,
          content: o.content,
          isCorrect: o.isCorrect,
        })),
      };
      await tx.examQuestion.update({
        where: { id: item.id },
        data: { snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
    }

    await tx.examVersion.update({
      where: { id: versionId },
      data: { status: "PUBLISHED", publishedAt: new Date() },
    });

    // Các bản publish cũ chuyển sang lưu trữ để chỉ còn một bản đang chạy;
    // lượt thi cũ vẫn trỏ đúng version của nó nên không ảnh hưởng.
    await tx.examVersion.updateMany({
      where: { examId: version.examId, status: "PUBLISHED", id: { not: versionId } },
      data: { status: "ARCHIVED" },
    });

    await tx.exam.update({ where: { id: version.examId }, data: { status: "PUBLISHED" } });
  });

  return { ok: true as const, data: { versionId, itemCount: version.items.length } };
}

/** Payload câu hỏi lưu vào snapshot — chịu được dữ liệu cũ thiếu field. */
function readSnapshotPayload(raw: unknown) {
  const get = (key: string) => {
    if (raw && typeof raw === "object" && key in raw) {
      const value = (raw as Record<string, unknown>)[key];
      return typeof value === "string" ? value : "";
    }
    return "";
  };
  return { audioUrl: get("audioUrl"), transcript: get("transcript"), imageUrl: get("imageUrl") };
}

/** Xóa một version. Có lượt thi thì từ chối, vì xóa là mất bài làm. */
export async function deleteVersion(versionId: string) {
  const version = await prisma.examVersion.findUnique({
    where: { id: versionId },
    select: { id: true, examId: true, _count: { select: { attempts: true } } },
  });
  if (!version) return { ok: false as const, error: "Không tìm thấy phiên bản đề" };
  if (version._count.attempts > 0) {
    return {
      ok: false as const,
      error: `Phiên bản này đã có ${version._count.attempts} lượt thi nên không xóa được.`,
    };
  }
  const remaining = await prisma.examVersion.count({ where: { examId: version.examId } });
  if (remaining <= 1) {
    return { ok: false as const, error: "Đề phải còn ít nhất một phiên bản" };
  }
  await prisma.examVersion.delete({ where: { id: versionId } });
  return { ok: true as const, data: { id: versionId } };
}

/** Setting của version, luôn qua `readExamSettings` để dữ liệu cũ không làm vỡ. */
export async function getVersionSettings(versionId: string) {
  const version = await prisma.examVersion.findUnique({
    where: { id: versionId },
    select: { settings: true },
  });
  return readExamSettings(version?.settings ?? null);
}

// ─── Đọc form ────────────────────────────────────────────────────────────────

export function parseExamForm(form: FormData): Result<ExamInput> {
  return {
    ok: true,
    data: {
      code: String(form.get("code") ?? "").trim(),
      title: String(form.get("title") ?? "").trim(),
      description: String(form.get("description") ?? "").trim() || null,
      // Chuỗi rỗng nghĩa là "không gắn", không phải id rỗng
      lessonId: String(form.get("lessonId") ?? "").trim() || null,
      courseId: String(form.get("courseId") ?? "").trim() || null,
    },
  };
}
