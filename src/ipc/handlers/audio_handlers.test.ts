import { beforeEach, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { getRegisteredHandlerForTesting } from "./base";
import {
  cancelAudioTranscriptionForTesting,
  registerAudioHandlers,
} from "./audio_handlers";

const mocks = vi.hoisted(() => ({
  settings: {
    selectedModel: { provider: "custom::speech", name: "test-model" },
    providerSettings: {
      "custom::speech": { apiKey: { value: "custom-key" } },
    },
  },
  providers: [
    {
      id: "custom::speech",
      type: "custom",
      name: "Speech",
      apiBaseUrl: "https://speech.example.test/v1/",
    },
  ],
}));

vi.mock("electron", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ipcMain: undefined,
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => mocks.settings,
}));
vi.mock("@/ipc/shared/language_model_helpers", () => ({
  getLanguageModelProviders: async () => mocks.providers,
}));
vi.mock("@/ipc/utils/read_env", () => ({ getEnvVar: () => "" }));
vi.mock("@/lib/providerProxy", () => ({
  getProviderProxyUrl: () => undefined,
}));
vi.mock("@/ipc/pi/provider_proxy_fetch", () => ({
  runWithProviderProxy: async (
    _proxyUrl: string | undefined,
    request: () => Promise<Response>,
  ) => request(),
}));

registerAudioHandlers();

describe("audio transcription handler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.providers[0].apiBaseUrl = "https://speech.example.test/v1/";
  });

  it("uses the selected OpenAI-compatible provider", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ text: "hello" })));
    const handler = getRegisteredHandlerForTesting("audio:transcribe-audio");

    await expect(
      handler({} as never, {
        audioData: new Uint8Array([1, 2, 3]),
        filename: "recording.webm",
        requestId: "voice:test",
      }),
    ).resolves.toEqual({ text: "hello" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://speech.example.test/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer custom-key",
          "x-dyad-internal-request-id": "voice:test",
        }),
        body: expect.any(FormData),
      }),
    );
  });

  it("rejects a non-HTTP provider URL", async () => {
    mocks.providers[0].apiBaseUrl = "file:///tmp/provider";
    const handler = getRegisteredHandlerForTesting("audio:transcribe-audio");

    await expect(
      handler({} as never, {
        audioData: new Uint8Array([1]),
        filename: "recording.webm",
        requestId: "voice:test",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  });

  it("cancels an active provider request", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true },
          );
        }),
    );
    const handler = getRegisteredHandlerForTesting("audio:transcribe-audio");
    const request = handler({} as never, {
      audioData: new Uint8Array([1, 2, 3]),
      filename: "recording.webm",
      requestId: "voice:cancel-test",
    });

    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    cancelAudioTranscriptionForTesting("voice:cancel-test");

    await expect(request).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
  });
});
