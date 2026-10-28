import assert from "node:assert/strict";
import test from "node:test";
import { parsePhoneticsConfig } from "./learning-blocks";

function phoneticsConfig(audio: string | null) {
  return {
    sections: [{
      id: 1,
      title: "Nghe và luyện tập",
      audio,
      items: [{
        id: 1,
        type: "initial",
        given: "à",
        answer: "d",
        full: "dà",
        audioText: "dà",
      }],
    }],
  };
}

test("phonetics config accepts safe app upload audio paths", () => {
  const parsed = parsePhoneticsConfig(
    phoneticsConfig("/uploads/audio/phonetics/hsk1_lesson1_initials.mp3"),
  );

  assert.equal(parsed.ok, true);
});

test("phonetics config still accepts absolute audio URLs and missing audio", () => {
  assert.equal(parsePhoneticsConfig(phoneticsConfig("https://cdn.example.com/phonetics.mp3")).ok, true);
  assert.equal(parsePhoneticsConfig(phoneticsConfig(null)).ok, true);
});

test("phonetics config rejects unsafe or unrelated relative audio paths", () => {
  for (const audio of [
    "/private/audio.mp3",
    "/uploads/audio/../private.mp3",
    "/uploads/audio/%2e%2e/private.mp3",
    "/uploads/audio/file.mp3?download=1",
    "/uploads/audio/file.mp3#fragment",
  ]) {
    assert.equal(parsePhoneticsConfig(phoneticsConfig(audio)).ok, false, audio);
  }
});
