import assert from "node:assert/strict";
import test from "node:test";

function mockAnimationFrame() {
  const originalRequestAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: () => 0,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value() {},
  });
  return () => {
    if (originalRequestAnimationFrame) {
      Object.defineProperty(globalThis, "requestAnimationFrame", originalRequestAnimationFrame);
    } else {
      Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    }
    if (originalCancelAnimationFrame) {
      Object.defineProperty(globalThis, "cancelAnimationFrame", originalCancelAnimationFrame);
    } else {
      Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
    }
  };
}

test("MeloTTS failure falls back to the browser Chinese voice", async () => {
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
      matchMedia: () => ({ addEventListener() {} }),
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
    value: async () => { throw new Error("MeloTTS unavailable"); },
  });

  try {
    const { speakChinese, stopSpeaking } = await import("~/lib/speech");
    assert.equal(speakChinese("你好", null, { rate: 1.5 }), true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, "你好");
    assert.equal(spoken[0].lang, "zh-CN");
    assert.equal(spoken[0].rate, 1.5);

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

test("MeloTTS uses recorded vocabulary audio when available and generates it when missing", async () => {
  const restoreAnimationFrame = mockAnimationFrame();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const requests: RequestInit[] = [];
  const audioInstances: Array<{ src: string; playbackRate: number }> = [];
  let failServerRequests = false;
  let browserSpeechCount = 0;
  const speechSynthesis = {
    cancel() {},
    getVoices: () => [],
    speak() { browserSpeechCount += 1; },
  };

  class MockAudio {
    currentTime = 0;
    playbackRate = 1;
    onplay: (() => void) | null = null;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public src: string) { audioInstances.push(this); }
    play() {
      this.onplay?.();
      return Promise.resolve();
    }
    pause() {}
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      speechSynthesis,
      localStorage: { getItem: () => null, setItem() {} },
      addEventListener() {},
      matchMedia: () => ({ addEventListener() {} }),
    },
  });
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: MockAudio });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (failServerRequests) throw new Error("MeloTTS unavailable");
      requests.push(init ?? {});
      if (JSON.parse(String(init?.body)).intent === "cache-status") {
        return Response.json({ cached: false });
      }
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
    },
  });

  try {
    const { speakChinese, stopSpeaking } = await import("~/lib/speech");
    const { updateAppSetting } = await import("~/lib/app-settings");
    updateAppSetting("speechEngine", "melo");

    speakChinese("你好", "/audio/vocabulary.mp3", { preferAudio: true, rate: 1.5 });
    assert.equal(requests.length, 0);
    assert.equal(audioInstances.at(-1)?.src, "/audio/vocabulary.mp3");
    assert.equal(audioInstances.at(-1)?.playbackRate, 1.5);

    speakChinese("你好", null, { preferAudio: true, rate: 0.8 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, 2);
    assert.equal(audioInstances.at(-1)?.playbackRate, 0.8);
    assert.deepEqual(JSON.parse(String(requests[0].body)), {
      text: "你好",
      intent: "cache-status",
    });
    assert.deepEqual(JSON.parse(String(requests[1].body)), {
      text: "你好",
    });

    const requestCountBeforePreferredAudio = requests.length;
    const playbackStates: string[] = [];
    speakChinese("你好", "/audio/listening-question.mp3", {
      preferAudio: true,
      rate: 0.8,
      onPlaybackStateChange: (state) => playbackStates.push(state),
    });
    assert.equal(requests.length, requestCountBeforePreferredAudio);
    assert.equal(audioInstances.at(-1)?.src, "/audio/listening-question.mp3");
    assert.equal(audioInstances.at(-1)?.playbackRate, 0.8);
    assert.deepEqual(playbackStates, ["loading", "playing"]);
    stopSpeaking();
    assert.deepEqual(playbackStates, ["loading", "playing", "idle"]);

    updateAppSetting("speechEngine", "local");
    const requestCountBeforeForcedServerTts = requests.length;
    speakChinese("词语", null, {
      serverProvider: "melo",
      forceServerTts: true,
      allowBrowserFallback: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, requestCountBeforeForcedServerTts + 2);
    assert.deepEqual(JSON.parse(String(requests[requestCountBeforeForcedServerTts].body)), {
      text: "词语",
      intent: "cache-status",
    });
    assert.deepEqual(JSON.parse(String(requests[requestCountBeforeForcedServerTts + 1].body)), {
      text: "词语",
    });
    assert.equal(audioInstances.at(-1)?.src.startsWith("blob:"), true);
    assert.equal(browserSpeechCount, 0);

    failServerRequests = true;
    speakChinese("再见", null, {
      serverProvider: "melo",
      forceServerTts: true,
      allowBrowserFallback: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(browserSpeechCount, 0);
  } finally {
    restoreAnimationFrame();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
    else Reflect.deleteProperty(globalThis, "Audio");
    if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});

test("MeloTTS failures fall back locally on each request", async () => {
  const restoreAnimationFrame = mockAnimationFrame();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  let requestCount = 0;
  let localSpeechCount = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      speechSynthesis: {
        cancel() {},
        getVoices: () => [],
        speak() { localSpeechCount += 1; },
      },
      localStorage: { getItem: () => null, setItem() {} },
      addEventListener() {},
      matchMedia: () => ({ addEventListener() {} }),
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
    value: async () => {
      requestCount += 1;
      if (requestCount % 2 === 1) return Response.json({ cached: false });
      return Response.json({ error: "MeloTTS is temporarily unavailable" }, {
        status: 503,
      });
    },
  });

  try {
    const { speakChinese, stopSpeaking } = await import("~/lib/speech");
    const { updateAppSetting } = await import("~/lib/app-settings");
    updateAppSetting("speechEngine", "melo");

    speakChinese("你好");
    await new Promise((resolve) => setTimeout(resolve, 0));
    speakChinese("再见");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(requestCount, 4);
    assert.equal(localSpeechCount, 2);
    stopSpeaking();
  } finally {
    restoreAnimationFrame();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalUtterance) Object.defineProperty(globalThis, "SpeechSynthesisUtterance", originalUtterance);
    else Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance");
    if (originalFetch) Object.defineProperty(globalThis, "fetch", originalFetch);
    else Reflect.deleteProperty(globalThis, "fetch");
  }
});