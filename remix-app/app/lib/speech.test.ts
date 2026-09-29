import assert from "node:assert/strict";
import test from "node:test";

test("Edge TTS failure falls back to the browser Chinese voice", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const spoken: Array<{ text: string; lang: string; rate: number }> = [];
  const speechSynthesis = {
    cancel() {},
    getVoices: () => [{ lang: "zh-CN" }],
    speak: (utterance: { text: string; lang: string; rate: number }) => spoken.push(utterance),
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      speechSynthesis,
      localStorage: { getItem: () => null, setItem() {} },
      addEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: class {
      lang = "";
      rate = 1;
      voice: unknown;
      constructor(public text: string) {}
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async () => { throw new Error("Edge TTS unavailable"); },
  });

  try {
    const { speakChinese, stopSpeaking } = await import("~/lib/speech");
    assert.equal(speakChinese("你好"), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, "你好");
    assert.equal(spoken[0].lang, "zh-CN");
    stopSpeaking();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalUtterance) Object.defineProperty(globalThis, "SpeechSynthesisUtterance", originalUtterance);
    else Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
    if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});

test("Edge selection overrides vocabulary audio but listening can prefer its recording", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const requests: RequestInit[] = [];
  const audioInstances: Array<{ src: string }> = [];
  const speechSynthesis = { cancel() {}, getVoices: () => [], speak() {} };

  class MockAudio {
    currentTime = 0;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) { audioInstances.push(this); }
    play() { return Promise.resolve(); }
    pause() {}
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      speechSynthesis,
      localStorage: { getItem: () => null, setItem() {} },
      addEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: MockAudio });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(init ?? {});
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    },
  });

  try {
    const { speakChinese, stopSpeaking } = await import("~/lib/speech");
    const { updateAppSetting } = await import("~/lib/app-settings");
    updateAppSetting("speechEngine", "edge");

    speakChinese("你好", "/audio/vocabulary.mp3");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 1);

    speakChinese("你好", "/audio/listening-question.mp3", { preferAudio: true });
    assert.equal(requests.length, 1);
    assert.equal(audioInstances.at(-1)?.src, "/audio/listening-question.mp3");
    stopSpeaking();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
    else Reflect.deleteProperty(globalThis, "Audio");
    if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});