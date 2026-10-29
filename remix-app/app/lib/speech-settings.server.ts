import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getUploadsDirectory } from "~/lib/storage.server";
import {
  parseSpeechProviderSettings,
  SPEECH_PROVIDER_DEFAULTS,
  type ConfigurableSpeechProvider,
  type SpeechProviderSettings,
} from "~/lib/speech-settings";

function getSettingsPath(provider: ConfigurableSpeechProvider) {
  return path.join(getUploadsDirectory(), ".config", "tts", `${provider}.json`);
}

function isMissingFile(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function getSpeechProviderSettings(
  provider: ConfigurableSpeechProvider,
): Promise<SpeechProviderSettings> {
  try {
    const raw = await readFile(getSettingsPath(provider), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      throw new Error(`TTS settings for ${provider} must be a JSON object`);
    }
    const value = parsed as { speaker?: unknown; speed?: unknown };
    const settings = parseSpeechProviderSettings(provider, value.speaker, value.speed);
    if (!settings) throw new Error(`TTS settings for ${provider} are invalid`);
    return settings;
  } catch (error) {
    if (isMissingFile(error)) return SPEECH_PROVIDER_DEFAULTS[provider];
    throw error;
  }
}

export async function saveSpeechProviderSettings(
  provider: ConfigurableSpeechProvider,
  input: { speaker: unknown; speed: unknown },
) {
  const settings = parseSpeechProviderSettings(provider, input.speaker, input.speed);
  if (!settings) throw new Error("Cấu hình model hoặc tốc độ giọng đọc không hợp lệ.");

  const directory = path.dirname(getSettingsPath(provider));
  const destination = getSettingsPath(provider);
  const temporary = path.join(directory, `.${provider}.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(temporary, JSON.stringify(settings), { flag: "wx", mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
