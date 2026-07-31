import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WebAccessSettings } from "./WebAccessSettings";

const mocks = vi.hoisted(() => ({
  settings: {
    enableWebAccess: false,
    webSearchProvider: "auto",
    providerSettings: {},
  } as any,
  updateSettings: vi.fn(),
  getCredentialStatus: vi.fn(),
  setApiKey: vi.fn(),
  deleteApiKey: vi.fn(),
  testProvider: vi.fn(),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
  }),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    settings: {
      getWebSearchCredentialStatus: mocks.getCredentialStatus,
      setWebSearchApiKey: mocks.setApiKey,
      deleteWebSearchApiKey: mocks.deleteApiKey,
      testWebSearchProvider: mocks.testProvider,
    },
  },
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

function renderSettings() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebAccessSettings />
    </QueryClientProvider>,
  );
}

describe("WebAccessSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = {
      enableWebAccess: false,
      webSearchProvider: "auto",
      providerSettings: {},
    };
    mocks.updateSettings.mockResolvedValue(mocks.settings);
    mocks.getCredentialStatus.mockResolvedValue({
      hasExaKey: false,
      hasBraveKey: false,
    });
    mocks.setApiKey.mockResolvedValue({
      hasExaKey: true,
      hasBraveKey: false,
    });
    mocks.deleteApiKey.mockResolvedValue({
      hasExaKey: false,
      hasBraveKey: false,
    });
    mocks.testProvider.mockResolvedValue({ ok: true });
  });

  it("updates the web access toggle", () => {
    renderSettings();

    fireEvent.click(screen.getByRole("switch", { name: "Web access" }));

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      enableWebAccess: true,
    });
  });

  it("stores search keys through the dedicated credential IPC", async () => {
    mocks.settings.enableWebAccess = true;
    renderSettings();

    fireEvent.change(screen.getByLabelText("Exa API key value"), {
      target: { value: "exa-key" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => {
      expect(mocks.setApiKey).toHaveBeenCalledWith({
        provider: "exa",
        apiKey: "exa-key",
      });
    });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("deletes a configured key through the dedicated credential IPC", async () => {
    mocks.settings.enableWebAccess = true;
    mocks.getCredentialStatus.mockResolvedValue({
      hasExaKey: true,
      hasBraveKey: false,
    });
    renderSettings();

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(mocks.deleteApiKey).toHaveBeenCalledWith({ provider: "exa" });
    });
  });

  it("tests only a stored key without exposing its value", async () => {
    mocks.settings.enableWebAccess = true;
    mocks.settings.providerSettings = {
      "dyad-web-exa": { apiKey: { value: "must-not-render" } },
    };
    mocks.getCredentialStatus.mockResolvedValue({
      hasExaKey: true,
      hasBraveKey: false,
    });
    renderSettings();

    expect(screen.queryByText("must-not-render")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Test" }));

    await waitFor(() => {
      expect(mocks.testProvider).toHaveBeenCalledWith({ provider: "exa" });
    });
  });
});
