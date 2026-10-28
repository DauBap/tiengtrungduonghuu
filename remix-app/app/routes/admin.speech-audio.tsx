import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { AudioLines, Loader2, RefreshCw, Search, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { prisma } from "~/lib/prisma.server";
import { deleteSpeechAudioCache, regenerateSpeechAudioCache } from "~/lib/speech-audio.server";
import { getCachedSpeechAudioFileInfo } from "~/lib/storage.server";
import { requireRole } from "~/lib/session.server";

const PAGE_SIZE = 100;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const where = query ? { text: { contains: query, mode: "insensitive" as const } } : {};

  const [total, cacheEntries] = await Promise.all([
    prisma.speechAudioCache.count({ where }),
    prisma.speechAudioCache.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
      select: {
        cacheKey: true,
        text: true,
        engine: true,
        speaker: true,
        speed: true,
        filePath: true,
        updatedAt: true,
      },
    }),
  ]);
  const entries = await Promise.all(cacheEntries.map(async (entry) => ({
    ...entry,
    fileInfo: await getCachedSpeechAudioFileInfo(entry.cacheKey),
  })));

  return { user, query, total, entries };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const cacheKey = String(formData.get("cacheKey") ?? "");

  if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
    return { error: "Khóa audio không hợp lệ." };
  }

  const record = await prisma.speechAudioCache.findUnique({
    where: { cacheKey },
    select: { cacheKey: true, filePath: true },
  });
  if (!record) return { error: "Mục audio này không còn trong cache. Hãy tải lại trang." };
  if (record.filePath !== `/uploads/audio/tts/${cacheKey}.wav`) {
    console.error(`TTS cache path does not match cache key ${cacheKey}`);
    return { error: "Đường dẫn audio không hợp lệ; thao tác đã bị dừng để bảo vệ dữ liệu." };
  }

  if (intent === "delete") {
    try {
      await deleteSpeechAudioCache(cacheKey);
      return { success: true, intent };
    } catch (error) {
      console.error("Could not delete cached speech audio:", error);
      return { error: "Không thể xóa audio lúc này. Vui lòng thử lại." };
    }
  }

  if (intent === "regenerate") {
    try {
      await regenerateSpeechAudioCache(cacheKey);
      return { success: true, intent };
    } catch (error) {
      console.error("Could not regenerate cached speech audio:", error);
      return { error: "AI chưa thể tạo lại audio. Hãy kiểm tra dịch vụ MeloTTS rồi thử lại." };
    }
  }

  return { error: "Thao tác không được hỗ trợ." };
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatFileSize(bytes: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(bytes / 1024) + " KB";
}

function SpeechAudioEntry({ entry }: { entry: Awaited<ReturnType<typeof loader>>["entries"][number] }) {
  const fetcher = useFetcher<typeof action>();
  const isBusy = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data.success) {
      toast.success(fetcher.data.intent === "regenerate"
        ? "Đã tạo lại audio và cập nhật cache."
        : "Đã xóa audio khỏi cache.");
    }
  }, [fetcher.data, fetcher.state]);

  const audioUrl = `${entry.filePath}?v=${entry.updatedAt.getTime()}`;

  return (
    <article className="space-y-4 border-b py-5 last:border-b-0 sm:py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="content-text hanzi-display break-words text-2xl font-semibold">{entry.text}</h2>
          <p className="text-sm text-muted-foreground">
            {entry.engine} · Giọng {entry.speaker} · Tốc độ {entry.speed}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {entry.cacheKey.slice(0, 16)}…
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:shrink-0">
          <fetcher.Form
            method="post"
            onSubmit={(event) => {
              if (!window.confirm(`Tạo lại audio cho “${entry.text}”? Bản mới sẽ được dùng cho tất cả học viên.`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="regenerate" />
            <input type="hidden" name="cacheKey" value={entry.cacheKey} />
            <Button type="submit" variant="outline" size="sm" disabled={isBusy}>
              {isBusy && fetcher.formData?.get("intent") === "regenerate"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <RefreshCw className="mr-2 h-4 w-4" />}
              Tạo lại bằng AI
            </Button>
          </fetcher.Form>
          <fetcher.Form
            method="post"
            onSubmit={(event) => {
              if (!window.confirm(`Xóa audio cache của “${entry.text}”? Lần nghe tiếp theo sẽ tạo audio mới.`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="intent" value="delete" />
            <input type="hidden" name="cacheKey" value={entry.cacheKey} />
            <Button type="submit" variant="destructive" size="sm" disabled={isBusy}>
              {isBusy && fetcher.formData?.get("intent") === "delete"
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Trash2 className="mr-2 h-4 w-4" />}
              Xóa cache
            </Button>
          </fetcher.Form>
        </div>
      </div>

      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          {entry.fileInfo
            ? `${formatFileSize(entry.fileInfo.size)} · Cập nhật ${formatDate(entry.updatedAt)}`
            : "Không tìm thấy tệp audio trên máy chủ"}
        </p>
        {entry.fileInfo ? (
          <audio
            key={audioUrl}
            className="h-10 w-full sm:max-w-sm"
            controls
            preload="none"
            src={audioUrl}
            aria-label={`Nghe thử audio: ${entry.text}`}
          />
        ) : (
          <span className="text-sm text-warning">Hãy tạo lại để khôi phục tệp nghe thử.</span>
        )}
      </div>
    </article>
  );
}

export default function AdminSpeechAudio() {
  const { user, query, total, entries } = useLoaderData<typeof loader>();

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Quản lý audio AI</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Tìm và nghe thử audio MeloTTS. Nếu phát âm chưa đúng, bạn có thể tạo lại ngay; audio mới sẽ được dùng cho tất cả học viên.
          </p>
        </header>

        <section className="rounded-lg border bg-muted/30 p-4 sm:p-5" aria-label="Tìm audio">
          <Form method="get" className="flex flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="speech-audio-search">Tìm theo chữ Hán hoặc nội dung câu</label>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="speech-audio-search"
                name="q"
                defaultValue={query}
                placeholder="Tìm theo chữ Hán hoặc nội dung câu…"
                className="pl-9"
                maxLength={100}
              />
            </div>
            <Button type="submit" className="sm:min-w-28">
              <Search className="mr-2 h-4 w-4" />
              Tìm audio
            </Button>
          </Form>
          <p className="mt-3 text-xs text-muted-foreground">
            {total === 1 ? "1 mục" : `${total} mục`}
            {query ? ` khớp với “${query}”` : " trong cache"}
            {total > entries.length ? ` · Đang hiển thị ${entries.length} mục gần đây; hãy tìm cụ thể hơn để xem mục cũ.` : ""}
          </p>
        </section>

        <section aria-label="Danh sách audio cache">
          {entries.length > 0 ? (
            <div>
              {entries.map((entry) => <SpeechAudioEntry key={entry.cacheKey} entry={entry} />)}
            </div>
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed px-6 py-10 text-center">
              {query ? <Search className="mb-3 h-6 w-6 text-muted-foreground" /> : <AudioLines className="mb-3 h-6 w-6 text-muted-foreground" />}
              <h2 className="font-semibold">{query ? "Không tìm thấy audio phù hợp" : "Chưa có audio trong cache"}</h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                {query
                  ? "Thử tìm bằng chữ Hán khác hoặc một phần nội dung câu."
                  : "Audio MeloTTS sẽ xuất hiện tại đây sau khi được tạo lần đầu."}
              </p>
            </div>
          )}
        </section>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Volume2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Xóa cache không xóa nội dung bài học. Khi audio bị xóa, lần nghe tiếp theo sẽ tự tạo lại.</span>
        </p>
      </div>
    </AppShell>
  );
}
