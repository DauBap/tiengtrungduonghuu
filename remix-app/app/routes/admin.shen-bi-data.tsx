import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import * as XLSX from "xlsx";
import { Card, CardContent } from "~/components/ui/card";
import { requireRole } from "~/lib/session.server";
import { prisma } from "~/lib/prisma.server";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 3_000;

interface ImportRow {
  hskLevel: number;
  lesson: number;
  chinese: string;
  chineseAlternatives: string[];
  pinyin: string;
  pinyinAlternatives: string[];
  translation: string;
  translationAlternatives: string[];
  audioUrl: string | null;
  source: string;
}

interface ImportActionResult {
  success?: boolean;
  message?: string;
  error?: string;
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase("vi").replace(/[\s_-]+/g, "");
}

function getCell(row: Record<string, unknown>, ...names: string[]): string {
  const keyByNormalizedName = new Map(
    Object.keys(row).map((key) => [normalizeHeader(key), key]),
  );
  for (const name of names) {
    const key = keyByNormalizedName.get(normalizeHeader(name));
    if (key && row[key] !== null && row[key] !== undefined) return String(row[key]).trim();
  }
  return "";
}

function splitAlternatives(value: string): string[] {
  return [...new Set(value.split(/[|;；、]/).map((item) => item.trim()).filter(Boolean))];
}

function validateAudioUrl(value: string): string | null {
  if (!value) return null;
  if (value.startsWith("/uploads/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.toString();
  } catch {
    return null;
  }
  return null;
}

function parseWorkbook(buffer: Uint8Array, selectedLevel: number): ImportRow[] {
  const workbook = XLSX.read(buffer, { type: "array", raw: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Tệp không có trang tính chứa từ vựng.");
  const inputRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
  if (inputRows.length === 0) throw new Error("Trang tính chưa có dòng từ vựng.");
  if (inputRows.length > MAX_ROWS) throw new Error(`Tệp vượt giới hạn ${MAX_ROWS.toLocaleString("vi-VN")} dòng.`);

  return inputRows.map((row, index) => {
    const line = index + 2;
    const levelValue = getCell(row, "HSK", "HSK level", "Cấp HSK");
    const lessonValue = getCell(row, "Bài", "Lesson", "Bài học");
    const chinese = getCell(row, "Hán tự", "Hanzi", "Chinese");
    const pinyin = getCell(row, "Pinyin");
    const translation = getCell(row, "Nghĩa tiếng Việt", "Nghĩa", "Translation", "Meaning");
    const source = getCell(row, "Nguồn HSK 3.0", "Nguồn", "Source");
    const lesson = Number(lessonValue);
    const hskLevel = Number(levelValue);
    if (!Number.isInteger(hskLevel) || hskLevel !== selectedLevel) {
      throw new Error(`Dòng ${line}: cấp HSK phải khớp với HSK ${selectedLevel} đang nhập.`);
    }
    if (!Number.isInteger(lesson) || lesson < 1 || lesson > 100) {
      throw new Error(`Dòng ${line}: bài học phải là số nguyên từ 1 đến 100.`);
    }
    if (!/\p{Script=Han}/u.test(chinese) || chinese.length > 80) {
      throw new Error(`Dòng ${line}: Hán tự không hợp lệ hoặc quá dài.`);
    }
    if (!pinyin || pinyin.length > 120 || !translation || translation.length > 500) {
      throw new Error(`Dòng ${line}: cần pinyin và nghĩa tiếng Việt hợp lệ.`);
    }
    if (!source || source.length > 240 || /hsk\s*2[.]?0/i.test(source) || !/3[.]0/.test(source)) {
      throw new Error(`Dòng ${line}: cần ghi rõ nguồn HSK 3.0; không nhận nguồn HSK 2.0.`);
    }
    const audioInput = getCell(row, "Audio URL", "Âm thanh", "Audio");
    const audioUrl = validateAudioUrl(audioInput);
    if (audioInput && !audioUrl) {
      throw new Error(`Dòng ${line}: Audio URL chỉ được là đường dẫn /uploads/ hoặc URL HTTPS.`);
    }
    const chineseAlternatives = splitAlternatives(getCell(row, "Đáp án Hán tự thay thế", "Hán tự thay thế", "Chinese alternatives"));
    const pinyinAlternatives = splitAlternatives(getCell(row, "Pinyin thay thế", "Pinyin alternatives"));
    const translationAlternatives = splitAlternatives(getCell(row, "Nghĩa thay thế", "Translation alternatives"));
    if (
      chineseAlternatives.length !== pinyinAlternatives.length
      || chineseAlternatives.length !== translationAlternatives.length
    ) {
      throw new Error(`Dòng ${line}: các cột đáp án thay thế phải có cùng số mục và đúng thứ tự tương ứng.`);
    }
    return {
      hskLevel,
      lesson,
      chinese,
      chineseAlternatives,
      pinyin,
      pinyinAlternatives,
      translation,
      translationAlternatives,
      audioUrl,
      source,
    };
  });
}

export async function loader({ request }: LoaderFunctionArgs) {
  await requireRole(request, ["admin"]);
  if (new URL(request.url).searchParams.get("format") === "template") {
    return new Response("\uFEFFHSK,Bài,Hán tự,Pinyin,Nghĩa tiếng Việt,Nguồn HSK 3.0,Đáp án Hán tự thay thế,Pinyin thay thế,Nghĩa thay thế,Audio URL\r\n", {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="than-but-tu-vung-mau.csv"',
        "Cache-Control": "no-store",
      },
    });
  }
  const levels = await prisma.shenbiVocabulary.groupBy({
    by: ["hskLevel"],
    _count: { _all: true },
    orderBy: { hskLevel: "asc" },
  });
  const lessonCounts = await prisma.shenbiVocabulary.groupBy({
    by: ["hskLevel", "lesson"],
    _count: { _all: true },
    orderBy: [{ hskLevel: "asc" }, { lesson: "asc" }],
  });
  return {
    levels: levels.map((level) => ({ level: level.hskLevel, wordCount: level._count._all })),
    lessonCounts: lessonCounts.map((lesson) => ({
      hskLevel: lesson.hskLevel,
      lesson: lesson.lesson,
      wordCount: lesson._count._all,
    })),
  };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  if (request.method !== "POST") return Response.json({ error: "Phương thức không được hỗ trợ." }, { status: 405 });
  const formData = await request.formData();
  const selectedLevel = Number(formData.get("hskLevel"));
  const file = formData.get("file");
  if (!Number.isInteger(selectedLevel) || selectedLevel < 1 || selectedLevel > 7) {
    return Response.json({ error: "Hãy chọn đúng một cấp HSK từ 1 đến 7–9." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Hãy chọn tệp CSV hoặc Excel có từ vựng." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return Response.json({ error: "Tệp vượt giới hạn 5 MB." }, { status: 413 });
  }
  if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
    return Response.json({ error: "Chỉ hỗ trợ tệp .csv, .xlsx hoặc .xls." }, { status: 415 });
  }

  let rows: ImportRow[];
  try {
    rows = parseWorkbook(new Uint8Array(await file.arrayBuffer()), selectedLevel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được tệp từ vựng.";
    return Response.json({ error: message }, { status: 400 });
  }

  const uniqueRows = new Set<string>();
  for (const row of rows) {
    const key = `${row.lesson}:${row.chinese}:${row.pinyin}`;
    if (uniqueRows.has(key)) {
      return Response.json({ error: `Tệp có dòng trùng bài, Hán tự và pinyin: ${row.chinese} (${row.pinyin}).` }, { status: 400 });
    }
    uniqueRows.add(key);
  }

  const result = await prisma.$transaction(rows.map((row) => prisma.shenbiVocabulary.upsert({
    where: {
      hskLevel_lesson_chinese_pinyin: {
        hskLevel: row.hskLevel,
        lesson: row.lesson,
        chinese: row.chinese,
        pinyin: row.pinyin,
      },
    },
    create: row,
    update: {
      chineseAlternatives: row.chineseAlternatives,
      pinyinAlternatives: row.pinyinAlternatives,
      translation: row.translation,
      translationAlternatives: row.translationAlternatives,
      audioUrl: row.audioUrl,
      source: row.source,
    },
    select: { id: true },
  })));
  return Response.json({
    success: true,
    level: selectedLevel,
    importedCount: result.length,
    message: `Đã nhập ${result.length} từ HSK ${selectedLevel === 7 ? "7–9" : selectedLevel} HSK 3.0. Dữ liệu hiện có được cập nhật theo khóa bài + Hán tự + pinyin.`,
  });
}

export default function AdminShenbiData() {
  const data = useLoaderData<typeof loader>();
  const fetcher = useFetcher<ImportActionResult>();
  const actionData = fetcher.data;
  const isSubmitting = fetcher.state !== "idle";
  const [selectedLevel, setSelectedLevel] = useState("1");
  const countByLevel = new Map(data.levels.map((level) => [level.level, level.wordCount]));

  return (
    <div className="mx-auto max-w-5xl space-y-7">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Quản lý nội dung</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dữ liệu từ vựng Thần Bút</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Nhập dữ liệu HSK 3.0 có nguồn rõ ràng. Mỗi dòng cần có Hán tự, pinyin, nghĩa, cấp HSK, bài học và nguồn; không nhập thay thế bằng danh sách HSK 2.0.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 7 }, (_, index) => index + 1).map((level) => {
          const words = countByLevel.get(level) ?? 0;
          return (
            <Card key={level} className="shadow-none">
              <CardContent className="flex items-center justify-between p-4">
                <div><p className="font-semibold">HSK {level === 7 ? "7–9" : level}</p><p className="mt-1 text-xs text-muted-foreground">Từ vựng bổ sung</p></div>
                <strong className="text-2xl tabular-nums">{words}</strong>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="max-w-3xl shadow-none">
        <CardContent className="p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><FileSpreadsheet size={19} /></span>
            <div>
              <h2 className="text-lg font-semibold">Nhập CSV hoặc Excel</h2>
              <p className="mt-1 text-sm text-muted-foreground">Tệp tối đa 5 MB, tối đa 3.000 dòng. Nhập lại cùng một từ sẽ cập nhật bản ghi hiện có.</p>
            </div>
          </div>

          <div className="mt-5 rounded-md border bg-muted/30 p-4">
            <p className="text-sm font-medium">Cột bắt buộc</p>
            <p className="mt-2 break-words font-mono text-xs leading-6 text-muted-foreground">
              HSK, Bài, Hán tự, Pinyin, Nghĩa tiếng Việt, Nguồn HSK 3.0
            </p>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              Cột tùy chọn: Đáp án Hán tự thay thế, Pinyin thay thế, Nghĩa thay thế, Audio URL. Ba cột đáp án thay thế phải có cùng số mục và cùng thứ tự, phân tách bằng dấu |. URL âm thanh chỉ nhận /uploads/ hoặc HTTPS.
            </p>
            <a href="?format=template" className="mt-3 inline-flex text-xs font-semibold text-primary underline underline-offset-4">
              Tải mẫu CSV trống
            </a>
          </div>

          <fetcher.Form method="post" encType="multipart/form-data" className="mt-5 space-y-4">
            <label className="grid max-w-xs gap-1.5 text-sm font-medium">
              Cấp độ trong tệp
              <select name="hskLevel" value={selectedLevel} onChange={(event) => setSelectedLevel(event.currentTarget.value)} className="h-10 rounded-md border bg-background px-3">
                {Array.from({ length: 7 }, (_, index) => index + 1).map((level) => (
                  <option key={level} value={level}>HSK {level === 7 ? "7–9" : level}</option>
                ))}
              </select>
            </label>
            <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed bg-muted/20 px-4 text-center hover:bg-muted/40">
              <Upload size={19} className="text-primary" />
              <span className="text-sm font-medium">Chọn tệp từ vựng</span>
              <span className="text-xs text-muted-foreground">CSV, XLSX hoặc XLS · tối đa 5 MB</span>
              <input name="file" type="file" accept=".csv,.xlsx,.xls" required className="sr-only" />
            </label>
            <button type="submit" disabled={isSubmitting} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-60">
              {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              {isSubmitting ? "Đang kiểm tra và nhập…" : "Kiểm tra rồi nhập từ"}
            </button>
          </fetcher.Form>
          {actionData && (
            <div role={actionData.success ? "status" : "alert"} className={`mt-4 flex items-start gap-2 rounded-md border p-3 text-sm ${actionData.success ? "border-green-700/20 bg-green-500/10 text-green-800 dark:text-green-200" : "border-destructive/20 bg-destructive/10 text-destructive"}`}>
              {actionData.success ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <AlertCircle size={17} className="mt-0.5 shrink-0" />}
              <span>{actionData.message ?? actionData.error}</span>
            </div>
          )}
        </CardContent>
      </Card>

      <section>
        <h2 className="text-lg font-semibold">Số từ theo bài đã nhập</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {data.lessonCounts.length === 0
            ? <p className="text-sm text-muted-foreground">Chưa có dữ liệu tải lên. HSK 1–3 có thể dùng kho bài học HSK 3.0 hiện có.</p>
            : data.lessonCounts.map((lesson) => (
              <span key={`${lesson.hskLevel}-${lesson.lesson}`} className="inline-flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-xs">
                HSK {lesson.hskLevel === 7 ? "7–9" : lesson.hskLevel} · Bài {lesson.lesson}
                <strong className="tabular-nums">{lesson.wordCount}</strong>
              </span>
            ))}
        </div>
      </section>
    </div>
  );
}
