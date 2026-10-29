import type { ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";
import {
  getOrCreateSpeechAudio,
  hasCachedSpeechAudio,
  type SpeechAudioProvider,
} from "~/lib/speech-audio.server";

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
  const intent = body && typeof body === "object" && "intent" in body ? body.intent : null;
  const requestedProvider = body && typeof body === "object" && "provider" in body ? body.provider : "melo";
  if (requestedProvider !== "melo" && requestedProvider !== "kokoro") {
    return Response.json({ error: "Unsupported speech provider" }, { status: 400 });
  }
  const provider: SpeechAudioProvider = requestedProvider;
  if (!text || text.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: "Text must be between 1 and 2000 characters" }, { status: 400 });
  }

  if (intent === "cache-status") {
    try {
      return Response.json(
        { cached: await hasCachedSpeechAudio(text, provider) },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      console.error(`Could not check ${provider} audio cache:`, error);
      return Response.json(
        { error: "Speech synthesis is temporarily unavailable" },
        { status: 502 },
      );
    }
  }

  try {
    const audio = await getOrCreateSpeechAudio(text, provider);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`${provider} synthesis failed:`, error);
    return Response.json(
      { error: "Speech synthesis is temporarily unavailable" },
      { status: 502 },
    );
  }
}