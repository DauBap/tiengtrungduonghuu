/**
 * Phát âm tiếng Trung.
 *
 * Mặc định dùng Web Speech API (SpeechSynthesis, lang zh-CN) — miễn phí, không cần storage.
 * Nếu VocabItem có `audioUrl` thì ưu tiên file audio đó (giọng thật).
 */

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
export function speakChinese(text: string, audioUrl?: string | null): boolean {
  if (typeof window === "undefined") return false;

  if (audioUrl) {
    const audio = new Audio(audioUrl);
    void audio.play().catch(() => {
      // File lỗi hoặc bị chặn autoplay → fallback sang TTS
      speakWithTts(text);
    });
    return true;
  }

  return speakWithTts(text);
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
  if (isSpeechSupported()) window.speechSynthesis.cancel();
}
