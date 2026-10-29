const MAX_CONCURRENT_PRELOADS = 2;
const PRELOAD_TIMEOUT_MS = 15_000;

interface NavigatorWithConnection extends Navigator {
  connection?: {
    effectiveType?: string;
    saveData?: boolean;
  };
}

export interface AudioPreloadSession {
  getAudioElement: (url: string) => HTMLAudioElement | undefined;
  dispose: () => void;
}

export function preloadAudioUrls(
  audioUrls: readonly (string | null | undefined)[]
): AudioPreloadSession {
  const audioElements = new Map<string, HTMLAudioElement>();

  if (typeof window === "undefined") {
    return { getAudioElement: () => undefined, dispose() {} };
  }

  const connection = (window.navigator as NavigatorWithConnection).connection;
  if (
    connection?.saveData
    || connection?.effectiveType === "slow-2g"
    || connection?.effectiveType === "2g"
  ) {
    return { getAudioElement: () => undefined, dispose() {} };
  }

  const urls = [...new Set(audioUrls.filter(
    (url): url is string => typeof url === "string" && url.trim().length > 0
  ))];
  const pending = new Map<HTMLAudioElement, number>();
  let nextUrlIndex = 0;
  let activePreloads = 0;
  let disposed = false;

  const release = (audio: HTMLAudioElement) => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  };

  const startNext = () => {
    while (!disposed && activePreloads < MAX_CONCURRENT_PRELOADS && nextUrlIndex < urls.length) {
      const url = urls[nextUrlIndex++];
      const audio = new Audio();
      audio.preload = "auto";
      audio.src = url;
      audioElements.set(url, audio);
      activePreloads += 1;

      let settled = false;
      let timeoutId = 0;
      const finish = (failed: boolean) => {
        if (settled || disposed) return;
        settled = true;
        window.clearTimeout(timeoutId);
        pending.delete(audio);
        audio.oncanplaythrough = null;
        audio.onerror = null;
        activePreloads -= 1;

        if (failed) {
          if (audioElements.get(url) === audio) audioElements.delete(url);
          release(audio);
        }

        startNext();
      };

      audio.oncanplaythrough = () => finish(false);
      audio.onerror = () => finish(true);
      timeoutId = window.setTimeout(() => finish(true), PRELOAD_TIMEOUT_MS);
      pending.set(audio, timeoutId);
      audio.load();
    }
  };

  startNext();

  return {
    getAudioElement: (url) => audioElements.get(url),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const [audio, timeoutId] of pending) {
        window.clearTimeout(timeoutId);
        audio.oncanplaythrough = null;
        audio.onerror = null;
      }
      pending.clear();
      for (const audio of audioElements.values()) release(audio);
      audioElements.clear();
    },
  };
}
