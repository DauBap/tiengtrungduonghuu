import "dotenv/config";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

type ReviewStatus = "CAN_ADVANCE" | "CANNOT_ADVANCE" | "DROPPED_OUT";
type LegacyDecision = "PROMOTE" | "ELIGIBLE_NOT_ENROLLED" | "REPEAT";

type DemoClass = {
  level: number;
  completed: boolean;
  midtermReview?: ReviewStatus;
  finalReview?: ReviewStatus;
  legacyDecision?: LegacyDecision;
};

const demoCases: { key: string; label: string; classes: DemoClass[] }[] = [
  { key: "01", label: "Current HSK1", classes: [{ level: 1, completed: false }] },
  { key: "02", label: "Eligible to advance", classes: [{ level: 1, completed: true, finalReview: "CAN_ADVANCE" }] },
  {
    key: "03",
    label: "Cannot advance and dropped out",
    classes: [
      { level: 1, completed: true, finalReview: "CANNOT_ADVANCE" },
      { level: 3, completed: true, finalReview: "DROPPED_OUT" },
    ],
  },
  {
    key: "04",
    label: "Enrolled in next level",
    classes: [
      { level: 1, completed: true, finalReview: "CANNOT_ADVANCE" },
      { level: 2, completed: false },
    ],
  },
  { key: "05", label: "No previous level", classes: [{ level: 4, completed: false }] },
  {
    key: "06",
    label: "Completed without evaluation",
    classes: [
      { level: 3, completed: true },
      { level: 5, completed: true },
    ],
  },
  {
    key: "07",
    label: "Legacy decisions",
    classes: [
      { level: 1, completed: true, legacyDecision: "PROMOTE" },
      { level: 3, completed: true, legacyDecision: "ELIGIBLE_NOT_ENROLLED" },
      { level: 4, completed: true, legacyDecision: "REPEAT" },
    ],
  },
  {
    key: "08",
    label: "Midterm final and legacy result",
    classes: [{
      level: 2,
      completed: true,
      midtermReview: "CANNOT_ADVANCE",
      finalReview: "CAN_ADVANCE",
      legacyDecision: "REPEAT",
    }],
  },
  {
    key: "09",
    label: "Full HSK path",
    classes: [
      { level: 1, completed: true, finalReview: "CAN_ADVANCE" },
      { level: 2, completed: true, finalReview: "CAN_ADVANCE" },
      { level: 3, completed: true, finalReview: "CAN_ADVANCE" },
      { level: 4, completed: true, finalReview: "CAN_ADVANCE" },
      { level: 5, completed: false },
    ],
  },
  { key: "10", label: "No classes", classes: [] },
];

function assertLocalDatabase() {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error("DATABASE_URL is not configured.");

  const databaseUrl = new URL(configuredUrl);
  const databaseName = databaseUrl.pathname.replace(/^\//, "");
  if (databaseUrl.hostname !== "127.0.0.1" || databaseName !== "tiengtrung_local") {
    throw new Error("Demo seeding is restricted to 127.0.0.1/tiengtrung_local.");
  }
}

async function main() {
  assertLocalDatabase();
  const prisma = new PrismaClient();

  try {
    const [courses, teacher] = await Promise.all([
      prisma.course.findMany({
        where: { hskLevel: { in: [1, 2, 3, 4, 5] } },
        select: { id: true, code: true, hskLevel: true, status: true, createdAt: true },
      }),
      prisma.user.findFirst({
        where: { role: "teacher", deletedAt: null },
        orderBy: { name: "asc" },
        select: { id: true },
      }),
    ]);
    const courseByLevel = new Map<number, (typeof courses)[number]>();
    for (const level of [1, 2, 3, 4, 5]) {
      const options = courses
        .filter((course) => course.hskLevel === level)
        .sort((left, right) =>
          Number(right.status === "PUBLISHED") - Number(left.status === "PUBLISHED")
          || right.createdAt.getTime() - left.createdAt.getTime());
      const course = options[0];
      if (!course) throw new Error(`No course is configured for HSK ${level}.`);
      courseByLevel.set(level, course);
    }

    const passwords = new Map(
      await Promise.all(demoCases.map(async ({ key }) => [
        key,
        await bcrypt.hash(randomBytes(24).toString("hex"), 10),
      ] as const)),
    );

    await prisma.$transaction(async (tx) => {
      for (const demoCase of demoCases) {
        const userId = `demo-hsk-matrix-${demoCase.key}`;
        const email = `demo-hsk-matrix-${demoCase.key}@example.test`;
        const existingUser = await tx.user.findUnique({
          where: { email },
          select: { id: true, role: true },
        });
        if (existingUser && (existingUser.id !== userId || existingUser.role !== "student")) {
          throw new Error(`Refusing to overwrite a non-demo account at ${email}.`);
        }

        const student = await tx.user.upsert({
          where: { email },
          update: {
            name: `ZZZ DEMO HSK ${demoCase.key} - ${demoCase.label}`,
            phone: `09000000${demoCase.key}`,
            isActive: false,
            isActivated: false,
            mustChangePassword: true,
            deletedAt: null,
          },
          create: {
            id: userId,
            email,
            name: `ZZZ DEMO HSK ${demoCase.key} - ${demoCase.label}`,
            phone: `09000000${demoCase.key}`,
            password: passwords.get(demoCase.key)!,
            role: "student",
            isActive: false,
            isActivated: false,
            mustChangePassword: true,
          },
        });

        for (const demoClass of demoCase.classes) {
          const course = courseByLevel.get(demoClass.level);
          if (!course) throw new Error(`Missing course for HSK ${demoClass.level}.`);

          const classId = `${userId}-hsk${demoClass.level}`;
          const className = `DEMO HSK ${demoCase.key} · ${course.code}`;
          const existingClass = await tx.class.findUnique({
            where: { id: classId },
            select: { name: true, courseId: true },
          });
          if (existingClass && (existingClass.name !== className || existingClass.courseId !== course.id)) {
            throw new Error(`Refusing to overwrite a non-demo class at ${classId}.`);
          }

          const enrolledAt = new Date(Date.UTC(2026, 8, 1 + demoClass.level));
          const completedAt = demoClass.completed
            ? new Date(Date.UTC(2026, 9, 10 + demoClass.level))
            : null;
          await tx.class.upsert({
            where: { id: classId },
            update: {
              name: className,
              courseId: course.id,
              teacherId: teacher?.id ?? null,
              completedAt,
              midtermReviewSession: 5,
              finalReviewSession: 10,
            },
            create: {
              id: classId,
              name: className,
              courseId: course.id,
              teacherId: teacher?.id ?? null,
              completedAt,
              midtermReviewSession: 5,
              finalReviewSession: 10,
            },
          });

          await tx.enrollment.upsert({
            where: { userId_courseId: { userId: student.id, courseId: course.id } },
            update: { classId, createdAt: enrolledAt },
            create: { userId: student.id, courseId: course.id, classId, createdAt: enrolledAt },
          });

          for (const [sessionType, status] of [
            ["MIDTERM", demoClass.midtermReview],
            ["FINAL", demoClass.finalReview],
          ] as const) {
            if (!status) continue;
            await tx.studentClassReview.upsert({
              where: {
                classId_studentId_sessionType: {
                  classId,
                  studentId: student.id,
                  sessionType,
                },
              },
              update: {
                sessionNumber: sessionType === "MIDTERM" ? 5 : 10,
                status,
                teacherId: teacher?.id ?? null,
                adminAction: null,
                adminActionReason: null,
              },
              create: {
                classId,
                studentId: student.id,
                sessionType,
                sessionNumber: sessionType === "MIDTERM" ? 5 : 10,
                status,
                teacherId: teacher?.id ?? null,
              },
            });
          }

          if (demoClass.legacyDecision) {
            await tx.classFinalResult.upsert({
              where: { classId_studentId: { classId, studentId: student.id } },
              update: {
                score: 8,
                comment: `Dữ liệu demo ${demoCase.key}: kiểm tra kết quả cũ và mới.`,
                attendedSessions: 9,
                totalSessions: 10,
                decision: demoClass.legacyDecision,
              },
              create: {
                classId,
                studentId: student.id,
                score: 8,
                comment: `Dữ liệu demo ${demoCase.key}: kiểm tra kết quả cũ và mới.`,
                attendedSessions: 9,
                totalSessions: 10,
                decision: demoClass.legacyDecision,
              },
            });
          }
        }
      }
    }, { timeout: 60_000 });

    const [studentCount, classCount, enrollmentCount, reviewCount, resultCount] = await Promise.all([
      prisma.user.count({ where: { id: { startsWith: "demo-hsk-matrix-" } } }),
      prisma.class.count({ where: { id: { startsWith: "demo-hsk-matrix-" } } }),
      prisma.enrollment.count({ where: { userId: { startsWith: "demo-hsk-matrix-" } } }),
      prisma.studentClassReview.count({ where: { studentId: { startsWith: "demo-hsk-matrix-" } } }),
      prisma.classFinalResult.count({ where: { studentId: { startsWith: "demo-hsk-matrix-" } } }),
    ]);
    const expectedClassCount = demoCases.reduce((count, demoCase) => count + demoCase.classes.length, 0);
    const expectedReviewCount = demoCases.reduce(
      (count, demoCase) => count + demoCase.classes.reduce(
        (classCount, demoClass) => classCount + Number(Boolean(demoClass.midtermReview)) + Number(Boolean(demoClass.finalReview)),
        0,
      ),
      0,
    );
    const expectedResultCount = demoCases.reduce(
      (count, demoCase) => count + demoCase.classes.filter((demoClass) => demoClass.legacyDecision).length,
      0,
    );
    if (
      studentCount !== demoCases.length
      || classCount !== expectedClassCount
      || enrollmentCount !== expectedClassCount
      || reviewCount !== expectedReviewCount
      || resultCount !== expectedResultCount
    ) {
      throw new Error("Demo seed verification failed: record counts do not match the demo cases.");
    }

    console.log(`Verified ${studentCount} demo students, ${classCount} classes, and ${enrollmentCount} enrollments.`);
    console.log(`Also created ${reviewCount} review records and ${resultCount} legacy final results.`);
    console.log("Search the student history page for: ZZZ DEMO HSK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
