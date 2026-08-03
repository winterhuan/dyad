import { describe, expect, it } from "vitest";
import { transition } from "./transition";

describe("voice-to-text transition", () => {
  it("records, stops, and transcribes one correlated attempt", () => {
    const acquiring = transition(
      { type: "idle" },
      { type: "TOGGLE", attempt: "a" },
    );
    expect(acquiring).toMatchObject({
      kind: "applied",
      state: { type: "acquiring", attempt: "a" },
    });
    if (acquiring.kind !== "applied") throw new Error("expected transition");

    const recording = transition(acquiring.state, {
      type: "MEDIA_ACQUIRED",
      attempt: "a",
    });
    expect(recording).toMatchObject({ state: { type: "recording" } });
    if (recording.kind !== "applied") throw new Error("expected transition");

    const stopping = transition(recording.state, {
      type: "TOGGLE",
      attempt: "ignored-new-id",
    });
    expect(stopping).toMatchObject({
      state: { type: "stopping", attempt: "a", reason: "user" },
    });
    if (stopping.kind !== "applied") throw new Error("expected transition");

    expect(
      transition(stopping.state, {
        type: "RECORDER_STOPPED",
        attempt: "a",
        hasAudio: true,
      }),
    ).toMatchObject({
      state: { type: "transcribing", attempt: "a" },
      commands: expect.arrayContaining([{ type: "Transcribe", attempt: "a" }]),
    });
  });

  it("releases stale acquired media without changing the active attempt", () => {
    expect(
      transition(
        { type: "acquiring", attempt: "new" },
        { type: "MEDIA_ACQUIRED", attempt: "old" },
      ),
    ).toEqual({
      kind: "applied",
      state: { type: "acquiring", attempt: "new" },
      commands: [{ type: "ReleaseMedia", attempt: "old" }],
    });
  });

  it("ignores stale transcription completion", () => {
    expect(
      transition(
        { type: "transcribing", attempt: "new" },
        { type: "TRANSCRIPTION_OK", attempt: "old", text: "stale" },
      ),
    ).toMatchObject({ kind: "ignored", reason: "stale-attempt" });
  });
});
