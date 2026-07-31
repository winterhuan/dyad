import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  readEffectiveSettings: vi.fn(),
  writeSettings: vi.fn(),
  searchWeb: vi.fn(),
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
  readEffectiveSettings: mocks.readEffectiveSettings,
  writeSettings: mocks.writeSettings,
}));

vi.mock("@/ipc/pi/tools/dyad/web_access", () => ({
  searchWeb: mocks.searchWeb,
}));

import {
  deleteWebSearchApiKey,
  getWebSearchCredentialStatus,
  redactWebSearchCredentials,
  setWebSearchApiKey,
  testWebSearchProvider,
  writeRendererUserSettings,
} from "./web_search_settings_service";

const baseSettings = {
  selectedModel: { provider: "anthropic", name: "test" },
  providerSettings: {},
} as any;

describe("web search settings service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readSettings.mockReturnValue(baseSettings);
    mocks.readEffectiveSettings.mockResolvedValue(baseSettings);
    mocks.searchWeb.mockResolvedValue({ provider: "exa", text: "result" });
  });

  it("removes web search credential providers without mutating settings", () => {
    const settings = {
      ...baseSettings,
      providerSettings: {
        "dyad-web-exa": { apiKey: { value: "exa-secret" } },
        "dyad-web-brave": { apiKey: { value: "brave-secret" } },
        anthropic: { apiKey: { value: "anthropic-secret" } },
      },
    };

    const redacted = redactWebSearchCredentials(settings);

    expect(redacted.providerSettings["dyad-web-exa"]).toBeUndefined();
    expect(redacted.providerSettings["dyad-web-brave"]).toBeUndefined();
    expect(redacted.providerSettings.anthropic?.apiKey?.value).toBe(
      "anthropic-secret",
    );
    expect(settings.providerSettings["dyad-web-exa"].apiKey.value).toBe(
      "exa-secret",
    );
  });

  it("preserves hidden web credentials when renderer settings replace providers", async () => {
    const storedSettings = {
      ...baseSettings,
      providerSettings: {
        "dyad-web-exa": { apiKey: { value: "exa-secret" } },
      },
    };
    mocks.readSettings.mockReturnValue(storedSettings);
    mocks.readEffectiveSettings.mockResolvedValue(storedSettings);

    await writeRendererUserSettings({
      providerSettings: {
        anthropic: { apiKey: { value: "anthropic-secret" } },
      },
    });

    expect(mocks.writeSettings).toHaveBeenCalledWith({
      providerSettings: {
        anthropic: { apiKey: { value: "anthropic-secret" } },
        "dyad-web-exa": { apiKey: { value: "exa-secret" } },
      },
    });
  });

  it("rejects attempts to bypass the dedicated credential IPC", async () => {
    await expect(
      writeRendererUserSettings({
        providerSettings: {
          "dyad-web-exa": { apiKey: { value: "injected" } },
        },
      }),
    ).rejects.toThrow("dedicated credential settings");
    expect(mocks.writeSettings).not.toHaveBeenCalled();
  });

  it("normalizes and stores an Exa key", () => {
    mocks.readSettings.mockReturnValueOnce(baseSettings).mockReturnValueOnce({
      ...baseSettings,
      providerSettings: {
        "dyad-web-exa": { apiKey: { value: "exa-key" } },
      },
    });

    expect(
      setWebSearchApiKey({ provider: "exa", apiKey: "  exa-key  " }),
    ).toEqual({ hasExaKey: true, hasBraveKey: false });
    expect(mocks.writeSettings).toHaveBeenCalledWith({
      providerSettings: {
        "dyad-web-exa": { apiKey: { value: "exa-key" } },
      },
    });
  });

  it("deletes only the selected web search credential", () => {
    const settings = {
      ...baseSettings,
      providerSettings: {
        "dyad-web-exa": { apiKey: { value: "exa-key" } },
        "dyad-web-brave": { apiKey: { value: "brave-key" } },
      },
    };
    mocks.readSettings.mockReturnValueOnce(settings).mockReturnValueOnce({
      ...settings,
      providerSettings: {
        "dyad-web-brave": { apiKey: { value: "brave-key" } },
      },
    });

    expect(deleteWebSearchApiKey({ provider: "exa" })).toEqual({
      hasExaKey: false,
      hasBraveKey: true,
    });
    expect(mocks.writeSettings).toHaveBeenCalledWith({
      providerSettings: {
        "dyad-web-brave": { apiKey: { value: "brave-key" } },
      },
    });
  });

  it("tests a stored key without returning search content", async () => {
    mocks.readSettings.mockReturnValue({
      ...baseSettings,
      providerSettings: {
        "dyad-web-brave": { apiKey: { value: "brave-key" } },
      },
    });

    await expect(testWebSearchProvider({ provider: "brave" })).resolves.toEqual(
      { ok: true },
    );
    expect(mocks.searchWeb).toHaveBeenCalledWith(
      { query: "Dyad", numResults: 1 },
      { provider: "brave", braveApiKey: "brave-key" },
    );
  });

  it("reports whether each web search credential is configured", () => {
    expect(
      getWebSearchCredentialStatus({
        ...baseSettings,
        providerSettings: {
          "dyad-web-exa": { apiKey: { value: "exa-key" } },
        },
      }),
    ).toEqual({ hasExaKey: true, hasBraveKey: false });
  });
});
