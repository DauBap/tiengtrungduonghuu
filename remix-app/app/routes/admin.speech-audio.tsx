import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useFetcher, useLoaderData } from "react-router";
import { AudioLines, BookOpenCheck, Headphones, Loader2, Pause, Play, RefreshCw, RotateCw, Save, Search, Settings2, Trash2, Volume2 } from "lucide-react";
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

  const [total, cacheEntries, edgeSettings, meloSettings, kokoroSettings] = await Promise.all([
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
    getSpeechProviderSettings("edge"),
    getSpeechProviderSettings("melo"),
    getSpeechProviderSettings("kokoro"),
  ]);
  const entries = await Promise.all(cacheEntries.map(async (entry) => ({
    ...entry,
    fileInfo: await getCachedSpeechAudioFileInfo(entry.cacheKey),
  })));

  return {
    user,
    query,
    total,
    entries,
    settings: { edge: edgeSettings, melo: meloSettings, kokoro: kokoroSettings },
  };
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
      return { error: "Không thể tạo lại audio. Hãy kiểm tra dịch vụ TTS hoặc kết nối Internet rồi thử lại." };
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
  const [provider, setProvider] = useState<ConfigurableSpeechProvider>("edge");
  const [speaker, setSpeaker] = useState(settings.edge.speaker);
  const [speed, setSpeed] = useState(settings.edge.speed);
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

      <div className="grid gap-3 sm:grid-cols-3" role="group" aria-label="Chọn model TTS">
        {(["edge", "kokoro", "melo"] as const).map((model) => (
          <button
            key={model}
            type="button"
            aria-pressed={provider === model}
            onClick={() => setProvider(model)}
            className={`rounded-lg border p-4 text-left transition-colors ${provider === model ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
          >
            <span className="block font-medium">
              {model === "edge" ? "Edge TTS · Mặc định" : model === "kokoro" ? "Kokoro · Từ vựng" : "MeloTTS"}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {model === "edge"
                ? "Giọng neural tiếng Trung online; audio lưu cache sau lần tạo đầu."
                : model === "kokoro"
                  ? "Model hexgrad/Kokoro-82M"
                  : "Model tiếng Trung cục bộ, speaker ZH"}
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
              disabled={SPEECH_PROVIDER_VOICES[provider].length < 2}
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

function VocabularyCachePanel({ edgeSettings }: { edgeSettings: SpeechProviderSettings }) {
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState("");
  const [processed, setProcessed] = useState(0);
  const [created, setCreated] = useState(0);
  const [alreadyCached, setAlreadyCached] = useState(0);
  const [failures, setFailures] = useState<Array<{ text: string; message: string }>>([]);
  const queueRef = useRef<string[]>([]);
  const cursorRef = useRef(0);
  const pauseRequestedRef = useRef(false);
  const failureCountRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function loadVocabulary() {
    setIsLoading(true);
    setStatus("");
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    try {
      const response = await fetch("/admin/speech-audio/vocabulary", {
        method: "GET",
        signal: controller.signal,
      });
      if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/json")) {
        throw new Error("Không nhận được danh sách từ vựng từ máy chủ. Hãy tải lại trang rồi thử lại.");
      }
      const result: unknown = await response.json();
      if (
        typeof result === "object"
        && result !== null
        && "vocabulary" in result
        && Array.isArray(result.vocabulary)
        && result.vocabulary.every((item) => typeof item === "string")
      ) {
        queueRef.current = result.vocabulary;
        cursorRef.current = 0;
        setVocabulary(result.vocabulary);
        setProcessed(0);
        setCreated(0);
        setAlreadyCached(0);
        setFailures([]);
        failureCountRef.current = 0;
        setIsPaused(false);
        setStatus(result.vocabulary.length
          ? `Đã tải ${result.vocabulary.length.toLocaleString("vi-VN")} từ duy nhất.`
          : "Chưa có từ vựng nào để tạo cache.");
      } else {
        const message = typeof result === "object" && result !== null && "error" in result
          && typeof result.error === "string"
          ? result.error
          : "Máy chủ trả về danh sách từ vựng không hợp lệ.";
        throw new Error(message);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setStatus(error instanceof Error ? error.message : "Không thể tải danh sách từ vựng.");
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }

  async function runFrom(startIndex: number) {
    const controller = controllerRef.current;
    const queue = queueRef.current;
    if (!controller || controller.signal.aborted) return;

    setIsRunning(true);
    setIsPaused(false);
    pauseRequestedRef.current = false;
    setStatus("Đang tạo cache Edge TTS tuần tự…");

    for (let index = startIndex; index < queue.length; index += 1) {
      if (controller.signal.aborted) return;
      if (pauseRequestedRef.current) {
        setIsRunning(false);
        setIsPaused(true);
        setStatus(`Đã tạm dừng tại ${cursorRef.current.toLocaleString("vi-VN")}/${queue.length.toLocaleString("vi-VN")}.`);
        return;
      }

      const text = queue[index];
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, provider: "edge", intent: "cache-only" }),
          signal: controller.signal,
        });
        const isJson = response.headers.get("Content-Type")?.toLowerCase().includes("application/json");
        const result: unknown = isJson ? await response.json().catch(() => null) : null;
        if (!response.ok) {
          const message = typeof result === "object" && result !== null && "error" in result
            && typeof result.error === "string"
            ? result.error
            : `Máy chủ trả về lỗi HTTP ${response.status}.`;
          throw new Error(message);
        }
        if (!isJson) {
          throw new Error("Phiên đăng nhập có thể đã hết hạn. Hãy tải lại trang rồi thử lại.");
        }
        if (
          typeof result !== "object"
          || result === null
          || !("cached" in result)
          || typeof result.cached !== "boolean"
        ) {
          throw new Error("Máy chủ trả về trạng thái cache không hợp lệ.");
        }

        if (result.cached) setAlreadyCached((count) => count + 1);
        else setCreated((count) => count + 1);
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : "Không tạo được audio.";
        setFailures((current) => [...current, { text, message }]);
        failureCountRef.current += 1;
      }

      cursorRef.current = index + 1;
      setProcessed(index + 1);
      if (pauseRequestedRef.current && cursorRef.current < queue.length) {
        setIsRunning(false);
        setIsPaused(true);
        setStatus(`Đã tạm dừng tại ${cursorRef.current.toLocaleString("vi-VN")}/${queue.length.toLocaleString("vi-VN")}.`);
        return;
      }
    }

    if (controller.signal.aborted) return;
    setIsRunning(false);
    setIsPaused(false);
    setStatus(failureCountRef.current > 0
      ? "Đã chạy xong; một số từ cần thử lại."
      : "Đã tạo xong cache cho danh sách từ vựng.");
  }

  function startBatch() {
    if (!queueRef.current.length || isRunning) return;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    cursorRef.current = 0;
    setProcessed(0);
    setCreated(0);
    setAlreadyCached(0);
    setFailures([]);
    failureCountRef.current = 0;
    void runFrom(0);
  }

  function resumeBatch() {
    if (!isPaused || isRunning) return;
    void runFrom(cursorRef.current);
  }

  function retryFailures() {
    const retryQueue = failures.map(({ text }) => text);
    if (!retryQueue.length || isRunning) return;
    queueRef.current = retryQueue;
    cursorRef.current = 0;
    setVocabulary(retryQueue);
    setProcessed(0);
    setCreated(0);
    setAlreadyCached(0);
    setFailures([]);
    failureCountRef.current = 0;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    void runFrom(0);
  }

  const progress = vocabulary.length ? Math.round((processed / vocabulary.length) * 100) : 0;

  return (
    <section className="space-y-5 rounded-lg border p-4 sm:p-6" aria-labelledby="vocabulary-cache-title">
      <header className="space-y-2">
        <h2 id="vocabulary-cache-title" className="text-lg font-semibold">Tạo trước cache từ vựng</h2>
        <p className="text-sm text-muted-foreground">
          Quét toàn bộ từ vựng trong các khóa học, gộp chữ Hán trùng nhau và chỉ tạo audio Edge còn thiếu.
          Dùng giọng {edgeSettings.speaker} · tốc độ {edgeSettings.speed.toFixed(2)}×.
        </p>
        <p className="text-sm text-muted-foreground">
          Job chạy tuần tự trên trang này. Nếu đóng hoặc rời trang, lượt chạy sẽ dừng; mở lại và chạy lại sẽ tự bỏ qua cache đã có.
        </p>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button type="button" variant="outline" onClick={loadVocabulary} disabled={isLoading || isRunning}>
          {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookOpenCheck className="mr-2 h-4 w-4" />}
          Tải danh sách từ vựng
        </Button>
        {vocabulary.length > 0 && !isRunning && !isPaused && processed === 0 && (
          <Button type="button" onClick={startBatch}>
            <Play className="mr-2 h-4 w-4" />
            Tạo cache cho {vocabulary.length.toLocaleString("vi-VN")} từ
          </Button>
        )}
        {isRunning && (
          <Button type="button" variant="outline" onClick={() => { pauseRequestedRef.current = true; }}>
            <Pause className="mr-2 h-4 w-4" /> Tạm dừng sau từ hiện tại
          </Button>
        )}
        {isPaused && (
          <Button type="button" onClick={resumeBatch}>
            <Play className="mr-2 h-4 w-4" /> Tiếp tục
          </Button>
        )}
        {!isRunning && failures.length > 0 && (
          <Button type="button" variant="outline" onClick={retryFailures}>
            <RotateCw className="mr-2 h-4 w-4" /> Thử lại {failures.length} từ lỗi
          </Button>
        )}
      </div>

      {vocabulary.length > 0 && (
        <div className="space-y-2">
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Tiến độ tạo cache từ vựng"
            aria-valuemin={0}
            aria-valuemax={vocabulary.length}
            aria-valuenow={processed}
          >
            <div className="h-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
            {processed.toLocaleString("vi-VN")}/{vocabulary.length.toLocaleString("vi-VN")} ·
            {" "}Mới tạo {created.toLocaleString("vi-VN")} ·
            {" "}Đã có cache {alreadyCached.toLocaleString("vi-VN")} ·
            {" "}Lỗi {failures.length.toLocaleString("vi-VN")}
          </p>
        </div>
      )}

      {status && <p className="text-sm" role="status">{status}</p>}

      {isRunning && cursorRef.current < vocabulary.length && (
        <p className="break-all text-sm text-muted-foreground">
          Đang xử lý: <span className="content-text hanzi-display text-foreground">{queueRef.current[cursorRef.current]}</span>
        </p>
      )}

      {failures.length > 0 && (
        <div className="space-y-2" aria-label="Các từ tạo audio thất bại">
          <h3 className="text-sm font-medium">Từ cần thử lại</h3>
          <ul className="max-h-52 space-y-2 overflow-y-auto rounded-md border p-3 text-sm">
            {failures.slice(0, 20).map(({ text, message }, index) => (
              <li key={`${text}-${index}`} className="break-words">
                <span className="content-text hanzi-display font-medium">{text}</span>
                <span className="text-muted-foreground"> — {message}</span>
              </li>
            ))}
          </ul>
          {failures.length > 20 && (
            <p className="text-xs text-muted-foreground">Còn {failures.length - 20} từ lỗi khác.</p>
          )}
        </div>
      )}
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
              Tạo lại audio
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
  const [activePanel, setActivePanel] = useState<"settings" | "batch" | "cache">("batch");

  return (
    <AppShell user={user}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">Quản lý audio TTS</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Tùy chỉnh giọng đọc hoặc quản lý các audio đã được tạo và lưu trong cache.
          </p>
        </header>

        <div className="flex gap-2 overflow-x-auto border-b" role="tablist" aria-label="Quản lý audio TTS">
          <button
            type="button"
            role="tab"
            aria-controls="speech-settings-panel"
            aria-selected={activePanel === "settings"}
            onClick={() => setActivePanel("settings")}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${activePanel === "settings" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <Settings2 className="h-4 w-4" /> Cấu hình giọng
          </button>
          <button
            type="button"
            role="tab"
            aria-controls="speech-batch-panel"
            aria-selected={activePanel === "batch"}
            onClick={() => setActivePanel("batch")}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${activePanel === "batch" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <BookOpenCheck className="h-4 w-4" /> Tạo cache từ vựng
          </button>
          <button
            type="button"
            role="tab"
            aria-controls="speech-cache-panel"
            aria-selected={activePanel === "cache"}
            onClick={() => setActivePanel("cache")}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium ${activePanel === "cache" ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            <AudioLines className="h-4 w-4" /> Audio cache
          </button>
        </div>

        <div id="speech-settings-panel" role="tabpanel" hidden={activePanel !== "settings"}>
          <SpeechSettingsPanel settings={settings} />
        </div>
        <div id="speech-batch-panel" role="tabpanel" hidden={activePanel !== "batch"}>
          <VocabularyCachePanel edgeSettings={settings.edge} />
        </div>
        <div id="speech-cache-panel" role="tabpanel" hidden={activePanel !== "cache"}>
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
                  : "Audio TTS sẽ xuất hiện tại đây sau khi được tạo lần đầu."}
              </p>
            </div>
          )}
        </section>

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Volume2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Xóa cache không xóa nội dung bài học. Khi audio bị xóa, lần nghe tiếp theo sẽ tự tạo lại.</span>
        </p>
        </div>
      </div>
    </AppShell>
  );
}
