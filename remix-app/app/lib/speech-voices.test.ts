import assert from "node:assert/strict";
import test from "node:test";
import { getEdgeVoice } from "~/lib/speech-voices";

test("maps selectable Chinese Edge voices to their service identifiers", () => {
  assert.equal(getEdgeVoice("xiaoxiao"), "zh-CN-XiaoxiaoNeural");
  assert.equal(getEdgeVoice("xiaoyi"), "zh-CN-XiaoyiNeural");
  assert.equal(getEdgeVoice("liaoning"), "zh-CN-liaoning-XiaobeiNeural");
});
