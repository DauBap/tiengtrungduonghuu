const AZURE_VOICE = "zh-CN-XiaoxiaoNeural";

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (character) => {
    switch (character) {
      case "<": return "&lt;";
      case ">": return "&gt;";
      case "&": return "&amp;";
      case '"': return "&quot;";
      case "'": return "&apos;";
      default: return character;
    }
  });
}

export function buildAzureSpeechSsml(text: string): string {
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="zh-CN"><voice name="${AZURE_VOICE}"><mstts:express-as style="chat">${escapeXml(text)}</mstts:express-as></voice></speak>`;
}
