export type ConfigurableSpeechProvider = "melo" | "kokoro";

export interface SpeechProviderSettings {
  speaker: string;
  speed: number;
}

export const SPEECH_PROVIDER_DEFAULTS: Record<ConfigurableSpeechProvider, SpeechProviderSettings> = {
  melo: { speaker: "ZH", speed: 0.85 },
  kokoro: { speaker: "zf_xiaobei", speed: 0.85 },
};

export const SPEECH_PROVIDER_VOICES: Record<ConfigurableSpeechProvider, readonly string[]> = {
  melo: ["ZH"],
  kokoro: [
    "zf_xiaobei",
    "zf_xiaoni",
    "zf_xiaoxiao",
    "zf_xiaoyi",
    "zm_yunjian",
    "zm_yunxi",
    "zm_yunxia",
    "zm_yunyang",
  ],
};

export function isConfigurableSpeechProvider(value: string): value is ConfigurableSpeechProvider {
  return value === "melo" || value === "kokoro";
}

export function parseSpeechProviderSettings(
  provider: ConfigurableSpeechProvider,
  speaker: unknown,
  speed: unknown,
): SpeechProviderSettings | null {
  const parsedSpeed = typeof speed === "number" ? speed : Number(speed);
  if (
    typeof speaker !== "string"
    || !SPEECH_PROVIDER_VOICES[provider].includes(speaker)
    || !Number.isFinite(parsedSpeed)
    || parsedSpeed < 0.5
    || parsedSpeed > 1.5
  ) {
    return null;
  }
  return { speaker, speed: parsedSpeed };
}
