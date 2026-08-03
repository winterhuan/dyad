import { z } from "zod";
import {
  createClient,
  createSendClient,
  defineContract,
  defineSendContract,
} from "../contracts/core";

export const MAX_AUDIO_RECORDING_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_RECORDING_DURATION_MS = 5 * 60 * 1000;
export const AUDIO_RECORDING_TIMESLICE_MS = 1_000;

const AudioRequestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Request ID contains invalid characters");

export const TranscribeAudioParamsSchema = z.object({
  audioData: z
    .instanceof(Uint8Array)
    .refine((data) => data.byteLength > 0, "Audio data cannot be empty")
    .refine(
      (data) => data.byteLength <= MAX_AUDIO_RECORDING_BYTES,
      `Audio data cannot exceed ${MAX_AUDIO_RECORDING_BYTES} bytes`,
    ),
  filename: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine(
      (filename) =>
        !filename.includes("/") &&
        !filename.includes("\\") &&
        filename !== "." &&
        filename !== "..",
      "Filename must not contain path separators",
    ),
  requestId: AudioRequestIdSchema,
});

export type TranscribeAudioParams = z.infer<typeof TranscribeAudioParamsSchema>;

export const audioContracts = {
  transcribeAudio: defineContract({
    channel: "audio:transcribe-audio",
    input: TranscribeAudioParamsSchema,
    output: z.object({ text: z.string() }),
  }),
} as const;

export const audioSendContracts = {
  cancelTranscription: defineSendContract({
    channel: "audio:cancel-transcription",
    input: z.object({ requestId: AudioRequestIdSchema }),
  }),
} as const;

export const audioClient = {
  ...createClient(audioContracts),
  ...createSendClient(audioSendContracts),
};
