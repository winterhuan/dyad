// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcContract } from "@/ipc/contracts/core";

const registeredHandlers = vi.hoisted(
  () =>
    new Map<
      string,
      (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>
    >(),
);

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  validateProviderApiKey: vi.fn(),
}));

vi.mock("@/ipc/handlers/base", () => ({
  createTypedHandler: vi.fn(
    (
      contract: IpcContract<string, never, never>,
      handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>,
    ) => {
      registeredHandlers.set(contract.channel, handler);
    },
  ),
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("../services/provider_api_key_validation_service", () => ({
  validateProviderApiKey: mocks.validateProviderApiKey,
}));

vi.mock("../services/web_search_settings_service", () => ({
  deleteWebSearchApiKey: vi.fn(),
  getWebSearchCredentialStatus: vi.fn(),
  readRendererUserSettings: vi.fn(),
  setWebSearchApiKey: vi.fn(),
  testWebSearchProvider: vi.fn(),
  writeRendererUserSettings: vi.fn(),
}));

import { settingsContracts } from "../types/settings";
import { registerSettingsHandlers } from "./settings_handlers";

describe("registerSettingsHandlers", () => {
  beforeEach(() => {
    registeredHandlers.clear();
    vi.clearAllMocks();
    registerSettingsHandlers();
  });

  it("validates an API key with the selected provider's saved proxy", async () => {
    mocks.readSettings.mockReturnValue({
      providerSettings: {
        google: { proxyUrl: { value: "http://google-proxy.test:8080" } },
        openrouter: {
          proxyUrl: { value: "http://openrouter-proxy.test:8080" },
        },
      },
    });
    mocks.validateProviderApiKey.mockResolvedValue({ ok: true });
    const handler = registeredHandlers.get(
      settingsContracts.validateProviderApiKey.channel,
    );
    if (!handler) throw new Error("Missing provider key validation handler");

    await expect(
      handler({} as IpcMainInvokeEvent, {
        provider: "google",
        apiKey: "google-test-key",
      }),
    ).resolves.toEqual({ ok: true });

    expect(mocks.validateProviderApiKey).toHaveBeenCalledWith(
      { provider: "google", apiKey: "google-test-key" },
      { proxyUrl: "http://google-proxy.test:8080" },
    );
  });
});
