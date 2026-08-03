import { ipc } from "@/ipc/types";
import {
  AUDIO_RECORDING_TIMESLICE_MS,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_RECORDING_DURATION_MS,
} from "@/ipc/types/audio";
import type { Clock, IdSource } from "@/state_machines/clock";
import { TimerLeaseScope } from "@/state_machines/timer_lease";
import type { VoiceCommandRunner } from "./controller";
import type { VoiceCommand, VoiceEvent } from "./state";

interface AttemptResources {
  stream: MediaStream;
  recorder?: MediaRecorder;
  chunks: Blob[];
  recordedBytes: number;
}

export function createBrowserVoiceCommandRunner(options: {
  clock: Clock;
  idSource: IdSource;
  callbacks: {
    onTranscription(text: string): void;
    onError?(message: string): void;
  };
}) {
  const attempts = new Map<string, AttemptResources>();
  const pending = new Set<string>();
  const released = new Set<string>();
  const transcriptions = new Map<string, string>();
  let callbacks = options.callbacks;
  const leases = new TimerLeaseScope<string, string, VoiceEvent>(options.clock);

  const release = (attempt: string) => {
    const resources = attempts.get(attempt);
    if (!resources) {
      if (pending.has(attempt)) released.add(attempt);
      return;
    }
    leases.remove(attempt);
    resources.stream.getTracks().forEach((track) => track.stop());
    attempts.delete(attempt);
  };

  const runner: VoiceCommandRunner & {
    updateCallbacks(next: typeof callbacks): void;
  } = {
    run(command: VoiceCommand, emit: (event: VoiceEvent) => void) {
      switch (command.type) {
        case "AcquireMedia":
          pending.add(command.attempt);
          void navigator.mediaDevices.getUserMedia({ audio: true }).then(
            (stream) => {
              pending.delete(command.attempt);
              if (released.delete(command.attempt)) {
                stream.getTracks().forEach((track) => track.stop());
                return;
              }
              attempts.set(command.attempt, {
                stream,
                chunks: [],
                recordedBytes: 0,
              });
              emit({ type: "MEDIA_ACQUIRED", attempt: command.attempt });
            },
            (error) => {
              pending.delete(command.attempt);
              emit({
                type: "MEDIA_DENIED",
                attempt: command.attempt,
                message:
                  error instanceof Error
                    ? error.message
                    : "Failed to access microphone",
              });
            },
          );
          return;
        case "StartRecorder": {
          const resources = attempts.get(command.attempt);
          if (!resources) return;
          let recorder: MediaRecorder;
          try {
            recorder = new MediaRecorder(resources.stream, {
              mimeType: "audio/webm",
            });
          } catch (error) {
            emit({
              type: "MEDIA_DENIED",
              attempt: command.attempt,
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to start audio recording",
            });
            return;
          }
          resources.recorder = recorder;
          recorder.ondataavailable = (event) => {
            if (!event.data.size) return;
            const nextBytes = resources.recordedBytes + event.data.size;
            if (nextBytes > MAX_AUDIO_RECORDING_BYTES) {
              emit({ type: "SIZE_LIMIT_REACHED", attempt: command.attempt });
              return;
            }
            resources.chunks.push(event.data);
            resources.recordedBytes = nextBytes;
            if (nextBytes >= MAX_AUDIO_RECORDING_BYTES) {
              emit({ type: "SIZE_LIMIT_REACHED", attempt: command.attempt });
            }
          };
          recorder.onstop = () =>
            emit({
              type: "RECORDER_STOPPED",
              attempt: command.attempt,
              hasAudio: resources.recordedBytes > 0,
            });
          recorder.start(AUDIO_RECORDING_TIMESLICE_MS);
          return;
        }
        case "StopRecorder": {
          const recorder = attempts.get(command.attempt)?.recorder;
          if (recorder && recorder.state !== "inactive") recorder.stop();
          return;
        }
        case "ReleaseMedia":
          release(command.attempt);
          return;
        case "ScheduleDurationLimit":
          leases.replace(
            command.attempt,
            command.attempt,
            MAX_AUDIO_RECORDING_DURATION_MS,
            (attempt) => ({ type: "DURATION_ELAPSED", attempt }),
            emit,
          );
          return;
        case "CancelDurationLimit":
          leases.remove(command.attempt);
          return;
        case "Transcribe": {
          const resources = attempts.get(command.attempt);
          const blob = new Blob(resources?.chunks ?? [], {
            type: "audio/webm",
          });
          const requestId = options.idSource.next("voice-transcription");
          transcriptions.set(command.attempt, requestId);
          void blob.arrayBuffer().then(async (buffer) => {
            if (transcriptions.get(command.attempt) !== requestId) return;
            try {
              const result = await ipc.audio.transcribeAudio({
                audioData: new Uint8Array(buffer),
                filename: "recording.webm",
                requestId,
              });
              emit({
                type: "TRANSCRIPTION_OK",
                attempt: command.attempt,
                text: result.text,
              });
            } catch (error) {
              emit({
                type: "TRANSCRIPTION_FAILED",
                attempt: command.attempt,
                message:
                  error instanceof Error
                    ? error.message
                    : "Transcription failed",
              });
            } finally {
              if (transcriptions.get(command.attempt) === requestId) {
                transcriptions.delete(command.attempt);
              }
            }
          });
          return;
        }
        case "DeliverTranscription":
          callbacks.onTranscription(command.text);
          return;
        case "NotifyError":
          callbacks.onError?.(command.message);
          return;
      }
    },
    dispose: () => {
      leases.dispose();
      for (const requestId of transcriptions.values()) {
        ipc.audio.cancelTranscription({ requestId });
      }
      transcriptions.clear();
    },
    updateCallbacks: (next) => {
      callbacks = next;
    },
  };
  return runner;
}
