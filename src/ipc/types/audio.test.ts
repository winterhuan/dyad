import { describe, expect, it } from "vitest";

import {
  audioSendContracts,
  MAX_AUDIO_RECORDING_BYTES,
  TranscribeAudioParamsSchema,
} from "./audio";

const validInput = {
  audioData: new Uint8Array([1]),
  filename: "recording.webm",
  requestId: "voice:test",
};

describe("TranscribeAudioParamsSchema", () => {
  it("accepts bounded audio input", () => {
    expect(TranscribeAudioParamsSchema.safeParse(validInput).success).toBe(
      true,
    );
  });

  it("rejects oversized audio and path-like filenames", () => {
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validInput,
        audioData: new Uint8Array(MAX_AUDIO_RECORDING_BYTES + 1),
      }).success,
    ).toBe(false);
    expect(
      TranscribeAudioParamsSchema.safeParse({
        ...validInput,
        filename: "../recording.webm",
      }).success,
    ).toBe(false);
  });

  it("validates transcription cancellation request IDs", () => {
    expect(
      audioSendContracts.cancelTranscription.input.safeParse({
        requestId: "voice:cancel-1",
      }).success,
    ).toBe(true);
    expect(
      audioSendContracts.cancelTranscription.input.safeParse({
        requestId: "bad request",
      }).success,
    ).toBe(false);
  });
});
