import path from "node:path";
import { put } from "@vercel/blob";

export type AssetKind = "workbook-image" | "lesson-audio";

export interface SaveAssetOptions {
  kind: AssetKind;
  lessonId?: string;
  sectionId?: string;
  questionId?: string;
  speakerId?: string;
}

function sanitizeSegment(value: string, fallback: string) {
  const safe = (value || fallback).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  return safe || fallback;
}

function extFromName(fileName: string) {
  return path.extname(fileName) || ".png";
}

export async function saveUploadedAsset(file: File | null, options: SaveAssetOptions): Promise<string | null> {
  if (!file || !file.name) return null;

  const kind = options.kind;
  if (kind === "workbook-image" && !file.type.startsWith("image/")) return null;
  if (kind === "lesson-audio" && !file.type.startsWith("audio/")) return null;

  const safeLesson = sanitizeSegment(options.lessonId ?? "lesson", "lesson");
  const uniqueStem = kind === "workbook-image"
    ? sanitizeSegment(options.sectionId ?? options.questionId ?? "question", "question")
    : sanitizeSegment(options.speakerId ?? "speaker", "speaker");

  const fileExt = path.extname(file.name) || (kind === "lesson-audio" ? ".audio" : ".png");
  const safeFileName = `${Date.now()}-${uniqueStem}${fileExt}`;

  const blobFolder = kind === "lesson-audio"
    ? path.posix.join("audio", "lessons", safeLesson)
    : path.posix.join("images", "workbooks", safeLesson);
  const blob = await put(path.posix.join(blobFolder, safeFileName), file, {
    access: "public",
    addRandomSuffix: true,
    contentType: file.type,
  });

  return blob.url;
}
