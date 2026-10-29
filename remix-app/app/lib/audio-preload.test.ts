import assert from "node:assert/strict";
import test from "node:test";

test("preloads unique audio URLs with bounded concurrency and releases them", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const audioInstances: MockAudio[] = [];

  class MockAudio {
    preload = "";
    src = "";
    oncanplaythrough: (() => void) | null = null;
    onerror: (() => void) | null = null;
    paused = false;
    removedSource = false;
    loadCount = 0;

    constructor() {
      audioInstances.push(this);
    }

    load() {
      this.loadCount += 1;
    }

    pause() {
      this.paused = true;
    }

    removeAttribute(name: string) {
      if (name === "src") {
        this.src = "";
        this.removedSource = true;
      }
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      navigator: { connection: {} },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
  });
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: MockAudio });

  try {
    const { preloadAudioUrls } = await import("~/lib/audio-preload");
    const session = preloadAudioUrls([
      "/audio/one.mp3",
      "/audio/one.mp3",
      null,
      "/audio/two.mp3",
      "/audio/three.mp3",
      "/audio/four.mp3",
    ]);

    assert.equal(audioInstances.length, 2);
    assert.equal(session.getAudioElement("/audio/one.mp3"), audioInstances[0]);
    assert.equal(session.getAudioElement("/audio/two.mp3"), audioInstances[1]);

    audioInstances[0].oncanplaythrough?.();
    assert.equal(audioInstances.length, 3);
    assert.equal(session.getAudioElement("/audio/three.mp3"), audioInstances[2]);

    audioInstances[1].onerror?.();
    assert.equal(session.getAudioElement("/audio/two.mp3"), undefined);
    assert.equal(audioInstances.length, 4);

    session.dispose();
    assert.equal(session.getAudioElement("/audio/one.mp3"), undefined);
    assert.equal(audioInstances.every((audio) => audio.paused && audio.removedSource), true);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
    else Reflect.deleteProperty(globalThis, "Audio");
  }
});

test("skips background audio downloads when data saving or a 2G connection is enabled", async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalAudio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  let createdAudioCount = 0;

  class MockAudio {
    constructor() {
      createdAudioCount += 1;
    }
  }

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      navigator: { connection: { saveData: true } },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    },
  });
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: MockAudio });

  try {
    const { preloadAudioUrls } = await import("~/lib/audio-preload");
    const session = preloadAudioUrls(["/audio/one.mp3"]);
    assert.equal(createdAudioCount, 0);
    assert.equal(session.getAudioElement("/audio/one.mp3"), undefined);
    session.dispose();

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        navigator: { connection: { effectiveType: "2g" } },
        setTimeout: globalThis.setTimeout,
        clearTimeout: globalThis.clearTimeout,
      },
    });
    const slowNetworkSession = preloadAudioUrls(["/audio/one.mp3"]);
    assert.equal(createdAudioCount, 0);
    slowNetworkSession.dispose();
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalAudio) Object.defineProperty(globalThis, "Audio", originalAudio);
    else Reflect.deleteProperty(globalThis, "Audio");
  }
});
