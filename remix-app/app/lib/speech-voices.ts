import type { SpeechVoice } from "~/lib/app-settings";

export const SPEECH_VOICES: {
  id: SpeechVoice;
  name: string;
  description: string;
  edgeVoice: string;
}[] = [
  {
    id: "xiaoxiao",
    name: "Xiaoxiao",
    description: "Giọng nữ mặc định",
    edgeVoice: "zh-CN-XiaoxiaoNeural",
  },
  {
    id: "xiaoyi",
    name: "Xiaoyi",
    description: "Giọng nữ",
    edgeVoice: "zh-CN-XiaoyiNeural",
  },
  {
    id: "liaoning",
    name: "Liêu Ninh (Xiaobei)",
    description: "Giọng nữ, ngữ điệu địa phương",
    edgeVoice: "zh-CN-liaoning-XiaobeiNeural",
  },
];

export function getEdgeVoice(voice: SpeechVoice): string {
  return SPEECH_VOICES.find((option) => option.id === voice)?.edgeVoice
    ?? SPEECH_VOICES[0].edgeVoice;
}
