import type { ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/session.server";

const MAX_TEXT_LENGTH = 2_000;
const MELO_TTS_URL = process.env.MELO_TTS_URL ?? "http://127.0.0.1:8766/synthesize";

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

  try {
    const response = await fetch(MELO_TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new Error(`MeloTTS returned HTTP ${response.status}`);
    }
    if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("audio/wav")) {
      throw new Error("MeloTTS returned an unsupported audio type");
    }
    return new Response(response.body, {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("MeloTTS synthesis failed:", error);
    return Response.json(
      { error: "MeloTTS is temporarily unavailable" },
      { status: 502 },
    );
  }
}