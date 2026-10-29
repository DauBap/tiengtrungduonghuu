import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { AudioLines, Headphones, Loader2, RefreshCw, Save, Search, Settings2, Trash2, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "~/components/layout/app-shell";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { prisma } from "~/lib/prisma.server";
import { deleteSpeechAudioCache, regenerateSpeechAudioCache } from "~/lib/speech-audio.server";
import { getCachedSpeechAudioFileInfo } from "~/lib/storage.server";
import {
  getSpeechProviderSettings,
  saveSpeechProviderSettings,
} from "~/lib/speech-settings.server";
import {
  isConfigurableSpeechProvider,
  SPEECH_PROVIDER_VOICES,
  type ConfigurableSpeechProvider,
  type SpeechProviderSettings,
} from "~/lib/speech-settings";
import { requireRole } from "~/lib/session.server";

const PAGE_SIZE = 100;

export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireRole(request, ["admin"]);
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const where = query ? { text: { contains: query, mode: "insensitive" as const } } : {};

  const [total, cacheEntries, meloSettings, kokoroSettings] = await Promise.all([
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
    getSpeechProviderSettings("melo"),
    getSpeechProviderSettings("kokoro"),
  ]);
  const entries = await Promise.all(cacheEntries.map(async (entry) => ({
    ...entry,
    fileInfo: await getCachedSpeechAudioFileInfo(entry.cacheKey),
  })));

  return { user, query, total, entries, settings: { melo: meloSettings, kokoro: kokoroSettings } };
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  if (intent === "save-settings") {
    const provider = String(formData.get("provider") ?? "");
    if (!isConfigurableSpeechProvider(provider)) {
      return { error: "Model TTS không hợp lệ." };
    }
    try {
      await saveSpeechProviderSettings(provider, {
        speaker: formData.get("speaker"),
        speed: formData.get("speed"),
      });
      return { success: true, intent };
    } catch (error) {
      console.error("Could not save TTS voice settings:", error);
      return { error: "Không thể lưu cấu hình giọng đọc. Vui lòng thử lại." };
    }
  }

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
      return { error: "AI chưa thể tạo lại audio. Hãy kiểm tra dịch vụ TTS rồi thử lại." };
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

function SpeechSettingsPanel({
  settings,
}: {
  settings: Record<ConfigurableSpeechProvider, SpeechProviderSettings>;
}) {
  const fetcher = useFetcher<typeof action>();
  const [provider, setProvider] = useState<ConfigurableSpeechProvider>("kokoro");
  const [speaker, setSpeaker] = useState(settings.kokoro.speaker);
  const [speed, setSpeed] = useState(settings.kokoro.speed);
  const [sample, setSample] = useState("你好，我是你的中文老师。我们一起学习新词语吧。");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const currentSettings = settings[provider];
  const isDirty = speaker !== currentSettings.speaker || speed !== currentSettings.speed;

  useEffect(() => {
    setSpeaker(currentSettings.speaker);
    setSpeed(currentSettings.speed);
  }, [currentSettings.speaker, currentSettings.speed]);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) {
      toast.error(fetcher.data.error);
    } else if (fetcher.data.success && fetcher.data.intent === "save-settings") {
      toast.success("Đã lưu cấu hình. Audio tạo mới sẽ dùng giọng này.");
    }
  }, [fetcher.data, fetcher.state]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  async function handlePreview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const response = await fetch("/admin/speech-audio/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, speaker, speed, text: sample }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new Error(typeof result?.error === "string" ? result.error : "Không thể tạo audio nghe thử.");
      }
      if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("audio/wav")) {
        throw new Error("Phiên đăng nhập đã hết hạn hoặc máy chủ trả dữ liệu không hợp lệ.");
      }
      const nextUrl = URL.createObjectURL(await response.blob());
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(nextUrl);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Không thể tạo audio nghe thử.");
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <section className="space-y-6 rounded-lg border p-4 sm:p-6" aria-labelledby="speech-settings-title">
      <div>
        <h2 id="speech-settings-title" className="text-lg font-semibold">Tinh chỉnh giọng đọc</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Nghe thử cấu hình trước khi lưu. Thiết lập chỉ áp dụng cho audio được tạo mới; audio đã có trong cache không bị thay đổi.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Chọn model TTS">
        {(["kokoro", "melo"] as const).map((model) => (
          <button
            key={model}
            type="button"
            aria-pressed={provider === model}
            onClick={() => setProvider(model)}
            className={`rounded-lg border p-4 text-left transition-colors ${provider === model ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <span className="block font-medium">{model === "kokoro" ? "Kokoro · Từ vựng" : "MeloTTS · Nghe câu"}</span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {model === "kokoro" ? "Model hexgrad/Kokoro-82M" : "Model tiếng Trung, speaker ZH"}
            </span>
          </button>
        ))}
      </div>

      <fetcher.Form method="post" className="space-y-6">
        <input type="hidden" name="intent" value="save-settings" />
        <input type="hidden" name="provider" value={provider} />
        <input type="hidden" name="speaker" value={speaker} />
        <input type="hidden" name="speed" value={speed} />

        <div className="grid gap-5 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="speech-voice" className="text-sm font-medium">Giọng</label>
            <select
              id="speech-voice"
              value={speaker}
              onChange={(event) => setSpeaker(event.target.value)}
              disabled={provider === "melo"}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
            >
              {SPEECH_PROVIDER_VOICES[provider].map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
            </select>
            {provider === "melo" && (
              <p className="text-xs text-muted-foreground">MeloTTS tiếng Trung hiện chỉ cung cấp speaker ZH.</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="speech-speed" className="text-sm font-medium">Tốc độ</label>
              <output htmlFor="speech-speed" className="text-sm tabular-nums text-muted-foreground">{speed.toFixed(2)}×</output>
            </div>
            <input
              id="speech-speed"
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-muted-foreground"><span>Chậm</span><span>Nhanh</span></div>
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="speech-sample" className="text-sm font-medium">Câu mẫu nghe thử</label>
          <textarea
            id="speech-sample"
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
          <p className="text-xs text-muted-foreground">Có thể thay câu mẫu để kiểm tra từ hoặc câu cụ thể (tối đa 500 ký tự).</p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button type="button" variant="outline" onClick={handlePreview} disabled={previewing || !sample.trim()}>
            {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Headphones className="mr-2 h-4 w-4" />}
            Nghe thử cấu hình
          </Button>
          <Button type="submit" disabled={!isDirty || fetcher.state !== "idle"}>
            {fetcher.state !== "idle" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Lưu cấu hình
          </Button>
        </div>
        {previewError && <p role="alert" className="text-sm text-destructive">{previewError}</p>}
        {previewUrl && (
          <audio
            key={previewUrl}
            controls
            autoPlay
            src={previewUrl}
            className="h-10 w-full sm:max-w-md"
            aria-label="Audio mẫu được tạo bằng cấu hình giọng hiện tại"
          />
        )}
      </fetcher.Form>
    </section>
  );
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
  const { user, query, total, entries, settings } = useLoaderData<typeof loader>();
  const [activePanel, setActivePanel] = useState<"settings" | "cache">("settings");

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Quản lý audio AI</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Tùy chỉnh giọng cho từng model hoặc quản lý các audio đã được tạo.
          </p>
        </header>

        <div className="flex gap-2 border-b" role="group" aria-label="Quản lý audio AI">
          <button
            type="button"
            aria-pressed={activePanel === "settings"}
            onClick={() => setActivePanel("settings")}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${activePanel === "settings" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Settings2 className="h-4 w-4" /> Cấu hình giọng
          </button>
          <button
            type="button"
            aria-pressed={activePanel === "cache"}
            onClick={() => setActivePanel("cache")}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${activePanel === "cache" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <AudioLines className="h-4 w-4" /> Audio cache
          </button>
        </div>

        {activePanel === "settings" ? (
          <SpeechSettingsPanel settings={settings} />
        ) : (
          <>
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
                  : "Audio AI sẽ xuất hiện tại đây sau khi được tạo lần đầu."}
              </p>
            </div>
          )}
        </section>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Volume2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Xóa cache không xóa nội dung bài học. Khi audio bị xóa, lần nghe tiếp theo sẽ tự tạo lại.</span>
        </p>
          </>
        )}
      </div>
    </AppShell>
  );
}
