import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseClosestRecognitionCandidate,
  mergeRecognitionTranscript,
} from "./pronunciation";

test("chooses the recognition candidate closest to the remaining lesson script", () => {
  assert.equal(
    chooseClosestRecognitionCandidate(["你号", "你好"], "你好世界"),
    "你好",
  );
  assert.equal(
    chooseClosestRecognitionCandidate(["世界", "世间"], "你好世界", "你好"),
    "世界",
  );
});

test("merges recognition sessions without duplicating overlapping characters", () => {
  assert.equal(mergeRecognitionTranscript("你好", "好世界"), "你好世界");
  assert.equal(mergeRecognitionTranscript("你好", "再见"), "你好再见");
  assert.equal(mergeRecognitionTranscript("", " 你好 "), "你好");
  assert.equal(mergeRecognitionTranscript("你好", ""), "你好");
});
