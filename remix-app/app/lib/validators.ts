import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Vui lòng nhập email hợp lệ"),
  password: z.string().min(1, "Mật khẩu là bắt buộc"),
});

export const courseSchema = z.object({
  code: z.string().min(2).max(20).regex(/^[A-Za-z0-9-]+$/),
  title: z.string().min(3).max(100),
  description: z.string().min(10).max(500),
  hskLevel: z.coerce.number().int().min(1).max(6),
  thumbnail: z.string().url().optional().or(z.literal("")),
  status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  order: z.coerce.number().int().min(0),
});

export type LoginFormValues = z.infer<typeof loginSchema>;
export type CourseFormValues = z.infer<typeof courseSchema>;
