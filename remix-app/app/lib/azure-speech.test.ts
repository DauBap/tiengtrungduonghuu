import assert from "node:assert/strict";
import test from "node:test";
import { buildAzureSpeechSsml } from "~/lib/azure-speech";

test("builds conversational Azure SSML with escaped user text", () => {
  const ssml = buildAzureSpeechSsml("你好 & <朋友>");
  assert.match(ssml, /voice name="zh-CN-XiaoxiaoNeural"/);
  assert.match(ssml, /<mstts:express-as style="chat">/);
  assert.match(ssml, /你好 &amp; &lt;朋友&gt;/);
});
