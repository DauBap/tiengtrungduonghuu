import type { ActionFunctionArgs } from "react-router";
import { EdgeTTS } from "node-edge-tts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireRole } from "~/lib/session.server";
import type { SpeechVoice } from "~/lib/app-settings";
import { getEdgeVoice, SPEECH_VOICES } from "~/lib/speech-voices";

const MAX_TEXT_LENGTH = 2_000;
const DEFAULT_VOICE: SpeechVoice = "xiaoxiao";
const EDGE_TTS_RETRY_DELAY_SECONDS = 30;
let edgeTtsCooldownUntil = 0;

function unavailableResponse(status: 429 | 503) {
  edgeTtsCooldownUntil = Date.now() + EDGE_TTS_RETRY_DELAY_SECONDS * 1_000;
  return Response.json(
    { error: status === 429 ? "Edge TTS is temporarily rate limited" : "Edge TTS is temporarily unavailable" },
    {
      status,
      headers: { "Retry-After": String(EDGE_TTS_RETRY_DELAY_SECONDS) },
    }
  );
}

function getHttpStatusCode(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("statusCode" in error)) return null;
  return typeof error.statusCode === "number" ? error.statusCode : null;
}

async function synthesizeSpeech(text: string, voice: SpeechVoice): Promise<Buffer> {
  const tts = new EdgeTTS({
    voice: getEdgeVoice(voice),
    lang: "zh-CN",
    rate: "-15%",
    timeout: 15_000,
  });
  const tempDirectory = await mkdtemp(join(tmpdir(), "chinese-edge-tts-"));
  try {
    const audioPath = join(tempDirectory, "speech.mp3");
    await tts.ttsPromise(text, audioPath);
    return await readFile(audioPath);
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["student", "teacher", "admin"]);
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const text = body && typeof body === "object" && "text" in body && typeof body.text === "string"
    ? body.text.trim()
    : "";
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: "Text must be between 1 and 2000 characters" }, { status: 400 });
  }

  const requestedEngine = body && typeof body === "object" && "engine" in body
    ? body.engine
    : "edge";
  if (requestedEngine !== "edge") {
    return Response.json({ error: "Unsupported speech engine" }, { status: 400 });
  }

  const requestedVoice = body && typeof body === "object" && "voice" in body
    ? body.voice
    : DEFAULT_VOICE;
  const voice = typeof requestedVoice === "string"
    ? SPEECH_VOICES.find((option) => option.id === requestedVoice)?.id
    : undefined;
  if (!voice) {
    return Response.json({ error: "Unsupported Chinese voice" }, { status: 400 });
  }

  if (Date.now() < edgeTtsCooldownUntil) {
    return Response.json(
      { error: "Edge TTS is temporarily unavailable" },
      {
        status: 503,
        headers: {
          "Retry-After": String(Math.ceil((edgeTtsCooldownUntil - Date.now()) / 1_000)),
        },
      }
    );
  }

  try {
    const audio = await synthesizeSpeech(text, voice);
    if (audio.length === 0) throw new Error("Edge TTS returned an empty audio stream");
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (getHttpStatusCode(error) === 429) {
      return unavailableResponse(429);
    }
    console.error("Edge TTS synthesis failed:", error);
    return unavailableResponse(503);
  }
}