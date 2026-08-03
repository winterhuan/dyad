import { ignore } from "@/state_machines/types";
import type {
  VoiceCommand,
  VoiceEvent,
  VoiceState,
  VoiceTransitionResult,
} from "./state";

const LIMIT_MESSAGES = {
  duration:
    "Recording reached the maximum duration and was stopped. Any captured audio will still be transcribed.",
  size: "Recording reached the maximum size and was stopped. Any captured audio will still be transcribed.",
} as const;

export function transition(
  state: VoiceState,
  event: VoiceEvent,
): VoiceTransitionResult {
  switch (event.type) {
    case "TOGGLE":
      if (state.type === "idle") {
        return {
          kind: "applied",
          state: { type: "acquiring", attempt: event.attempt },
          commands: [{ type: "AcquireMedia", attempt: event.attempt }],
        };
      }
      if (state.type === "acquiring") return ignore(state, "start-in-flight");
      if (state.type === "recording") return stopRecording(state, "user");
      return ignore(state, "busy");
    case "MEDIA_ACQUIRED":
      if (state.type !== "acquiring" || state.attempt !== event.attempt) {
        return {
          kind: "applied",
          state,
          commands: [{ type: "ReleaseMedia", attempt: event.attempt }],
        };
      }
      return {
        kind: "applied",
        state: { type: "recording", attempt: event.attempt },
        commands: [
          { type: "StartRecorder", attempt: event.attempt },
          { type: "ScheduleDurationLimit", attempt: event.attempt },
        ],
      };
    case "MEDIA_DENIED":
      if (
        (state.type !== "acquiring" && state.type !== "recording") ||
        state.attempt !== event.attempt
      ) {
        return ignore(state, "stale-attempt");
      }
      return {
        kind: "applied",
        state: { type: "idle" },
        commands: [
          { type: "CancelDurationLimit", attempt: event.attempt },
          { type: "ReleaseMedia", attempt: event.attempt },
          { type: "NotifyError", message: event.message },
        ],
      };
    case "SIZE_LIMIT_REACHED":
    case "DURATION_ELAPSED":
      if (state.type !== "recording" || state.attempt !== event.attempt) {
        return ignore(state, "stale-attempt");
      }
      return stopRecording(
        state,
        event.type === "SIZE_LIMIT_REACHED" ? "size" : "duration",
      );
    case "RECORDER_STOPPED":
      if (
        (state.type !== "recording" && state.type !== "stopping") ||
        state.attempt !== event.attempt
      ) {
        return ignore(state, "stale-attempt");
      }
      return {
        kind: "applied",
        state: event.hasAudio
          ? { type: "transcribing", attempt: event.attempt }
          : { type: "idle" },
        commands: [
          { type: "CancelDurationLimit", attempt: event.attempt },
          ...(event.hasAudio
            ? ([{ type: "Transcribe", attempt: event.attempt }] as const)
            : []),
          { type: "ReleaseMedia", attempt: event.attempt },
        ],
      };
    case "TRANSCRIPTION_OK":
      if (state.type !== "transcribing" || state.attempt !== event.attempt) {
        return ignore(state, "stale-attempt");
      }
      return {
        kind: "applied",
        state: { type: "idle" },
        commands: event.text.trim()
          ? [{ type: "DeliverTranscription", text: event.text.trim() }]
          : [],
      };
    case "TRANSCRIPTION_FAILED":
      if (state.type !== "transcribing" || state.attempt !== event.attempt) {
        return ignore(state, "stale-attempt");
      }
      return {
        kind: "applied",
        state: { type: "idle" },
        commands: [{ type: "NotifyError", message: event.message }],
      };
    default:
      return assertNever(event);
  }
}

function stopRecording(
  state: Extract<VoiceState, { type: "recording" }>,
  reason: "user" | "duration" | "size",
): VoiceTransitionResult {
  const commands: VoiceCommand[] = [
    { type: "CancelDurationLimit", attempt: state.attempt },
    { type: "StopRecorder", attempt: state.attempt, reason },
  ];
  if (reason !== "user") {
    commands.push({ type: "NotifyError", message: LIMIT_MESSAGES[reason] });
  }
  return {
    kind: "applied",
    state: { type: "stopping", attempt: state.attempt, reason },
    commands,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected voice-to-text value: ${JSON.stringify(value)}`);
}
