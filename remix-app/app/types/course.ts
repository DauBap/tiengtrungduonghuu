export type CourseStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface Course {
  id: string;
  code: string;
  title: string;
  description: string;
  // Prisma trả `String?` = string | null, không phải undefined
  thumbnail?: string | null;
  hskLevel: number;
  status: CourseStatus;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CourseInput {
  code: string;
  title: string;
  description: string;
  thumbnail?: string;
  hskLevel: number;
  status: CourseStatus;
  order: number;
}
