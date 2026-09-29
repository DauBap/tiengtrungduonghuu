import type { ActionFunctionArgs } from "react-router";
import { EdgeTTS } from "node-edge-tts";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requireRole } from "~/lib/session.server";

const MAX_TEXT_LENGTH = 2_000;

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

  let tempDirectory: string | null = null;
  try {
    tempDirectory = await mkdtemp(join(tmpdir(), "chinese-edge-tts-"));
    const audioPath = join(tempDirectory, "speech.mp3");
    const edgeTts = new EdgeTTS({
      voice: "zh-CN-XiaoxiaoNeural",
      lang: "zh-CN",
      rate: "-15%",
      timeout: 15_000,
    });
    await edgeTts.ttsPromise(text, audioPath);
    const audio = await readFile(audioPath);
    if (audio.length === 0) throw new Error("Edge TTS returned an empty audio stream");
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Edge TTS synthesis failed:", error);
    return Response.json({ error: "Edge TTS is unavailable" }, { status: 503 });
  } finally {
    if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
  }
}