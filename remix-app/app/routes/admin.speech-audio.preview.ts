import type { ActionFunctionArgs } from "react-router";
import { generateSpeechAudioPreview } from "~/lib/speech-audio.server";
import { requireRole } from "~/lib/session.server";
import {
  isConfigurableSpeechProvider,
  parseSpeechProviderSettings,
} from "~/lib/speech-settings";

const MAX_SAMPLE_LENGTH = 500;

export async function action({ request }: ActionFunctionArgs) {
  await requireRole(request, ["admin"]);

  const contentLength = request.headers.get("Content-Length");
  if (contentLength && Number(contentLength) > 8_192) {
    return Response.json({ error: "Yêu cầu nghe thử quá lớn." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Nội dung yêu cầu không hợp lệ." }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return Response.json({ error: "Cấu hình nghe thử không hợp lệ." }, { status: 400 });
  }
  const input = body as {
    provider?: unknown;
    speaker?: unknown;
    speed?: unknown;
    text?: unknown;
  };
  if (typeof input.provider !== "string" || !isConfigurableSpeechProvider(input.provider)) {
    return Response.json({ error: "Model TTS không hợp lệ." }, { status: 400 });
  }
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text || text.length > MAX_SAMPLE_LENGTH) {
    return Response.json({ error: "Câu mẫu phải có từ 1 đến 500 ký tự." }, { status: 400 });
  }
  const settings = parseSpeechProviderSettings(input.provider, input.speaker, input.speed);
  if (!settings) {
    return Response.json({ error: "Cấu hình giọng đọc không hợp lệ." }, { status: 400 });
  }

  try {
    const audio = await generateSpeechAudioPreview(text, input.provider, settings);
    return new Response(new Uint8Array(audio), {
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`Could not preview ${input.provider} speech settings:`, error);
    return Response.json(
      { error: "Không thể tạo audio nghe thử. Hãy kiểm tra dịch vụ TTS rồi thử lại." },
      { status: 502 },
    );
  }
}
