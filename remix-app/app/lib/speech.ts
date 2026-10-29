/**
 * Phát âm tiếng Trung.
 *
 * Dùng file audio có sẵn trước; khi cần TTS, chọn model theo ngữ cảnh hoặc cài đặt.
 */
import { getAppSettings, setSpeechStatus } from "~/lib/app-settings";
import { toast } from "sonner";

export type ServerSpeechProvider = "melo" | "kokoro";

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Chọn giọng tiếng Trung tốt nhất mà máy có, null nếu chưa load kịp */
function pickChineseVoice(): SpeechSynthesisVoice | null {
  if (!isSpeechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "zh-CN") ??
    voices.find((v) => v.lang.replace("_", "-").startsWith("zh")) ??
    null
  );
}

/**
 * Đọc `text` bằng tiếng Trung. Có `audioUrl` thì phát file đó thay vì TTS.
 * Trả về true nếu đã phát được, false nếu trình duyệt không hỗ trợ.
 */
let activeAudio: HTMLAudioElement | null = null;
let activeObjectUrl: string | null = null;
let activeController: AbortController | null = null;
let activeLoadingToastId: string | null = null;
let speechRequestId = 0;
let activePlaybackStateChange: ((state: SpeechPlaybackState) => void) | null = null;

export type SpeechPlaybackState = "loading" | "playing" | "idle";

function updatePlaybackState(state: SpeechPlaybackState, requestId: number) {
  if (requestId !== speechRequestId) return;
  activePlaybackStateChange?.(state);
  if (state === "idle") activePlaybackStateChange = null;
}

export function speakChinese(
  text: string,
  audioUrl?: string | null,
  options: {
    preferAudio?: boolean;
    rate?: 0.8 | 0.85 | 1 | 1.5;
    audioElement?: HTMLAudioElement;
    serverProvider?: ServerSpeechProvider;
    onPlaybackStateChange?: (state: SpeechPlaybackState) => void;
  } = {}
): boolean {
  if (typeof window === "undefined") return false;

  stopSpeaking();
  const rate = options.rate ?? 0.85;
  const requestId = speechRequestId;
  activePlaybackStateChange = options.onPlaybackStateChange ?? null;
  updatePlaybackState("loading", requestId);

  if (audioUrl && options.preferAudio) {
    const audio = options.audioElement ?? new Audio(audioUrl);
    let fallbackStarted = false;
    audio.playbackRate = rate;
    activeAudio = audio;
    audio.currentTime = 0;
    audio.onplay = () => updatePlaybackState("playing", requestId);
    audio.onended = () => {
      releaseActiveAudio();
      updatePlaybackState("idle", requestId);
    };
    const fallback = () => {
      if (requestId !== speechRequestId || fallbackStarted) return;
      fallbackStarted = true;
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      activeAudio = null;
      speakSelectedTts(text, rate, requestId);
    };
    audio.onerror = fallback;
    void audio.play().catch(fallback);
    return true;
  }

  return speakSelectedTts(text, rate, requestId, options.serverProvider);
}

function speakSelectedTts(
  text: string,
  rate: number,
  requestId: number,
  serverProvider: ServerSpeechProvider = "melo",
): boolean {
  if (getAppSettings().speechEngine === "melo") {
    void speakWithServerTts(text, requestId, rate, serverProvider);
    return true;
  }
  setSpeechStatus("local");
  return speakWithTts(text, rate, requestId);
}

async function speakWithServerTts(
  text: string,
  requestId: number,
  rate: number,
  provider: ServerSpeechProvider,
) {
  const controller = new AbortController();
  const loadingToastId = `speech-generation-${requestId}`;
  let fallbackStarted = false;
  let loadingToastShown = false;
  activeController = controller;
  try {
    const cacheResponse = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        ...(provider === "melo" ? {} : { provider }),
        intent: "cache-status",
      }),
      signal: controller.signal,
    });
    if (!cacheResponse.ok) {
      throw new Error(`Could not check ${provider} audio cache`);
    }
    const cacheStatus: unknown = await cacheResponse.json();
    if (
      typeof cacheStatus !== "object"
      || cacheStatus === null
      || !("cached" in cacheStatus)
      || typeof cacheStatus.cached !== "boolean"
    ) {
      throw new Error(`${provider} returned an invalid cache status`);
    }
    if (requestId !== speechRequestId) return;
    const isCached = cacheStatus.cached;
    if (!isCached) {
      loadingToastShown = true;
      activeLoadingToastId = loadingToastId;
      toast.loading("Đang tạo giọng đọc AI", {
        id: loadingToastId,
        className: "speech-generation-toast",
        description: "Lần đầu có thể cần chờ thêm một chút; những lần sau sẽ phát nhanh hơn.",
        duration: Infinity,
        position: "top-center",
      });
    }

    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        ...(provider === "melo" ? {} : { provider }),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${provider} speech request failed`);
    }
    const audioBlob = await response.blob();
    if (audioBlob.size === 0) throw new Error(`${provider} returned empty audio`);
    const objectUrl = URL.createObjectURL(audioBlob);
    if (requestId !== speechRequestId) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    activeObjectUrl = objectUrl;
    setSpeechStatus(provider);
    const audio = new Audio(objectUrl);
    audio.playbackRate = rate;
    activeAudio = audio;
    audio.onplay = () => updatePlaybackState("playing", requestId);
    audio.onended = () => {
      releaseActiveAudio();
      updatePlaybackState("idle", requestId);
    };
    const fallback = () => {
      if (requestId !== speechRequestId) return;
      if (fallbackStarted) return;
      fallbackStarted = true;
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      releaseActiveAudio();
      setSpeechStatus(`${provider}-fallback`);
      speakWithTts(text, rate, requestId);
    };
    audio.onerror = fallback;
    await audio.play();
  } catch {
    if (requestId === speechRequestId) {
      if (fallbackStarted) return;
      fallbackStarted = true;
      releaseActiveAudio();
      setSpeechStatus(`${provider}-fallback`);
      speakWithTts(text, rate, requestId);
    }
  } finally {
    if (loadingToastShown) {
      toast.dismiss(loadingToastId);
      if (activeLoadingToastId === loadingToastId) activeLoadingToastId = null;
    }
    if (activeController === controller) activeController = null;
  }
}

function releaseActiveAudio() {
  activeAudio = null;
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;
}

function speakWithTts(text: string, rate: number, requestId: number): boolean {
  if (!isSpeechSupported()) return false;
  // Hủy câu đang đọc để không xếp hàng chồng nhau khi bấm liên tục
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = rate;
  const voice = pickChineseVoice();
  if (voice) utterance.voice = voice;
  utterance.onstart = () => updatePlaybackState("playing", requestId);
  utterance.onend = () => updatePlaybackState("idle", requestId);
  utterance.onerror = () => updatePlaybackState("idle", requestId);
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  const onPlaybackStateChange = activePlaybackStateChange;
  activePlaybackStateChange = null;
  speechRequestId += 1;
  onPlaybackStateChange?.("idle");
  activeController?.abort();
  activeController = null;
  if (activeLoadingToastId) {
    toast.dismiss(activeLoadingToastId);
    activeLoadingToastId = null;
  }
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }
  if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
  activeObjectUrl = null;

  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
