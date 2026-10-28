/**
 * Phát âm tiếng Trung.
 *
 * Dùng file audio có sẵn trước; nếu không có thì chọn MeloTTS hoặc giọng máy.
 */
import { getAppSettings, setSpeechStatus } from "~/lib/app-settings";
import { toast } from "sonner";

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

export function speakChinese(
  text: string,
  audioUrl?: string | null,
  options: { preferAudio?: boolean } = {}
): boolean {
  if (typeof window === "undefined") return false;

  stopSpeaking();
  if (audioUrl && options.preferAudio) {
    const requestId = speechRequestId;
    const audio = new Audio(audioUrl);
    activeAudio = audio;
    audio.currentTime = 0;
    audio.onerror = () => {
      if (requestId !== speechRequestId) return;
      activeAudio = null;
      speakSelectedTts(text);
    };
    void audio.play().catch(() => {
      // File lỗi hoặc bị chặn autoplay → fallback sang TTS
      if (requestId !== speechRequestId) return;
      activeAudio = null;
      speakSelectedTts(text);
    });
    return true;
  }

  return speakSelectedTts(text);
}

function speakSelectedTts(text: string): boolean {
  if (getAppSettings().speechEngine === "melo") {
    const requestId = speechRequestId;
    void speakWithMeloTts(text, requestId);
    return true;
  }
  setSpeechStatus("local");
  return speakWithTts(text);
}

async function speakWithMeloTts(text: string, requestId: number) {
  const controller = new AbortController();
  const loadingToastId = `speech-generation-${requestId}`;
  let fallbackStarted = false;
  let loadingToastShown = false;
  activeController = controller;
  try {
    const cacheResponse = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, intent: "cache-status" }),
      signal: controller.signal,
    });
    if (!cacheResponse.ok) {
      throw new Error("Could not check MeloTTS cache");
    }
    const cacheStatus: unknown = await cacheResponse.json();
    if (
      typeof cacheStatus !== "object"
      || cacheStatus === null
      || !("cached" in cacheStatus)
      || typeof cacheStatus.cached !== "boolean"
    ) {
      throw new Error("MeloTTS returned an invalid cache status");
    }
    if (requestId !== speechRequestId) return;
    const isCached = cacheStatus.cached;
    if (!isCached) {
      loadingToastShown = true;
      activeLoadingToastId = loadingToastId;
      toast.loading("Đang tạo giọng đọc AI", {
        id: loadingToastId,
        description: "Lần đầu có thể cần chờ thêm một chút; những lần sau sẽ phát nhanh hơn.",
        duration: Infinity,
        position: "top-center",
        style: { width: "min(26rem, calc(100vw - 2rem))" },
      });
    }

    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error("MeloTTS request failed");
    }
    const audioBlob = await response.blob();
    if (audioBlob.size === 0) throw new Error("MeloTTS returned empty audio");
    const objectUrl = URL.createObjectURL(audioBlob);
    if (requestId !== speechRequestId) {
      URL.revokeObjectURL(objectUrl);
      return;
    }
    activeObjectUrl = objectUrl;
    setSpeechStatus("melo");
    const audio = new Audio(objectUrl);
    activeAudio = audio;
    audio.onended = releaseActiveAudio;
    const fallback = () => {
      if (requestId !== speechRequestId) return;
      if (fallbackStarted) return;
      fallbackStarted = true;
      releaseActiveAudio();
      setSpeechStatus("fallback");
      speakWithTts(text);
    };
    audio.onerror = fallback;
    await audio.play();
  } catch {
    if (requestId === speechRequestId) {
      if (fallbackStarted) return;
      fallbackStarted = true;
      releaseActiveAudio();
      setSpeechStatus("fallback");
      speakWithTts(text);
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

function speakWithTts(text: string): boolean {
  if (!isSpeechSupported()) return false;
  // Hủy câu đang đọc để không xếp hàng chồng nhau khi bấm liên tục
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.85;
  const voice = pickChineseVoice();
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function stopSpeaking() {
  speechRequestId += 1;
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
