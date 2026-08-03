import { ipcMain } from "electron";
import log from "electron-log";
import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import { getLanguageModelProviders } from "@/ipc/shared/language_model_helpers";
import { normalizeProviderApiKeyInput } from "@/lib/providerApiKey";
import { getProviderProxyUrl } from "@/lib/providerProxy";
import { parseOpenAIBaseUrl } from "@/lib/openaiBaseUrl";
import type { UserSettings } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { getEnvVar } from "@/ipc/utils/read_env";
import { runWithProviderProxy } from "@/ipc/pi/provider_proxy_fetch";
import { audioContracts, audioSendContracts } from "../types/audio";
import { createTypedHandler } from "./base";
import { assertTrustedRenderer } from "../utils/renderer_security";

const logger = log.scope("audio_handlers");
const activeTranscriptions = new Map<string, AbortController>();

interface TranscriptionProvider {
  providerId: string;
  baseUrl: string;
  apiKey: string;
}

function parseTranscriptionBaseUrl(value: string): string {
  try {
    return parseOpenAIBaseUrl(value);
  } catch (error) {
    throw new DyadError(
      error instanceof Error
        ? error.message
        : "Invalid transcription Base URL.",
      DyadErrorKind.Precondition,
    );
  }
}

async function resolveTranscriptionProvider(
  settings: UserSettings,
): Promise<TranscriptionProvider> {
  const selectedProvider = settings.selectedModel.provider;
  if (selectedProvider.startsWith("custom::")) {
    const provider = (await getLanguageModelProviders()).find(
      (item) => item.id === selectedProvider && item.type === "custom",
    );
    const apiKey = normalizeProviderApiKeyInput(
      settings.providerSettings?.[selectedProvider]?.apiKey?.value,
    );
    const environmentKey = provider?.envVarName
      ? normalizeProviderApiKeyInput(getEnvVar(provider.envVarName))
      : "";
    if (provider?.apiBaseUrl && (apiKey || environmentKey)) {
      return {
        providerId: selectedProvider,
        baseUrl: parseTranscriptionBaseUrl(provider.apiBaseUrl),
        apiKey: apiKey || environmentKey,
      };
    }
  }

  const openAI = settings.providerSettings?.openai;
  const apiKey =
    normalizeProviderApiKeyInput(openAI?.apiKey?.value) ||
    normalizeProviderApiKeyInput(getEnvVar("OPENAI_API_KEY"));
  if (!apiKey) {
    throw new DyadError(
      "Voice-to-text requires an OpenAI or selected OpenAI-compatible provider API key.",
      DyadErrorKind.Precondition,
    );
  }
  return {
    providerId: "openai",
    baseUrl: parseTranscriptionBaseUrl(
      (openAI as { baseUrl?: string } | undefined)?.baseUrl ||
        "https://api.openai.com/v1",
    ),
    apiKey,
  };
}

export function registerAudioHandlers() {
  createTypedHandler(audioContracts.transcribeAudio, async (_, input) => {
    if (activeTranscriptions.has(input.requestId)) {
      throw new DyadError(
        "An audio transcription with this request ID is already running.",
        DyadErrorKind.Conflict,
      );
    }
    const controller = new AbortController();
    const timeoutSignal = AbortSignal.timeout(5 * 60 * 1000);
    activeTranscriptions.set(input.requestId, controller);
    try {
      const settings = readSettings();
      const provider = await resolveTranscriptionProvider(settings);
      const form = new FormData();
      form.append(
        "file",
        new Blob([Uint8Array.from(input.audioData)], { type: "audio/webm" }),
        input.filename,
      );
      form.append("model", "whisper-1");

      const response = await runWithProviderProxy(
        getProviderProxyUrl(settings, provider.providerId),
        () =>
          fetch(`${provider.baseUrl}/audio/transcriptions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${provider.apiKey}`,
              "x-dyad-internal-request-id": input.requestId,
            },
            body: form,
            signal: AbortSignal.any([controller.signal, timeoutSignal]),
          }),
      );
      if (!response.ok) {
        const kind =
          response.status === 401 || response.status === 403
            ? DyadErrorKind.Auth
            : response.status === 429
              ? DyadErrorKind.RateLimited
              : DyadErrorKind.External;
        throw new DyadError(
          `Audio transcription failed (${response.status}).`,
          kind,
        );
      }
      const result = (await response.json()) as { text?: unknown };
      if (typeof result.text !== "string") {
        throw new DyadError(
          "Audio transcription returned an invalid response.",
          DyadErrorKind.External,
        );
      }
      return { text: result.text };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DyadError(
          "Audio transcription was cancelled.",
          DyadErrorKind.UserCancelled,
        );
      }
      if (timeoutSignal.aborted) {
        throw new DyadError(
          "Audio transcription timed out.",
          DyadErrorKind.External,
        );
      }
      if (isDyadError(error)) throw error;
      throw new DyadError(
        error instanceof Error
          ? `Audio transcription failed: ${error.message}`
          : "Audio transcription failed.",
        DyadErrorKind.External,
      );
    } finally {
      if (activeTranscriptions.get(input.requestId) === controller) {
        activeTranscriptions.delete(input.requestId);
      }
    }
  });

  ipcMain?.on(
    audioSendContracts.cancelTranscription.channel,
    (event, input: unknown) => {
      try {
        assertTrustedRenderer(event);
        const { requestId } =
          audioSendContracts.cancelTranscription.input.parse(input);
        activeTranscriptions.get(requestId)?.abort();
      } catch (error) {
        logger.error(
          "Ignoring invalid audio transcription cancellation",
          error,
        );
      }
    },
  );
}

export function cancelAudioTranscriptionForTesting(requestId: string): void {
  activeTranscriptions.get(requestId)?.abort();
}
