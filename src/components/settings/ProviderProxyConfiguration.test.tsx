import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProviderProxyConfiguration } from "./ProviderProxyConfiguration";

describe("ProviderProxyConfiguration", () => {
  it("validates and saves a provider-scoped proxy URL", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <ProviderProxyConfiguration
        provider="google"
        settings={{ providerSettings: {} } as any}
        updateSettings={updateSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("Provider proxy URL"), {
      target: { value: "  http://127.0.0.1:10808  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save proxy" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        providerSettings: {
          google: { proxyUrl: { value: "http://127.0.0.1:10808" } },
        },
      }),
    );
  });

  it("rejects unsupported protocols before saving", () => {
    const updateSettings = vi.fn();
    render(
      <ProviderProxyConfiguration
        provider="google"
        settings={{ providerSettings: {} } as any}
        updateSettings={updateSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("Provider proxy URL"), {
      target: { value: "ftp://proxy.example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save proxy" }));

    expect(screen.getByText(/must use http:\/\//)).not.toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("rejects SOCKS proxies because all provider transports require HTTP(S)", () => {
    const updateSettings = vi.fn();
    render(
      <ProviderProxyConfiguration
        provider="bedrock"
        settings={{ providerSettings: {} } as any}
        updateSettings={updateSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("Provider proxy URL"), {
      target: { value: "socks5://127.0.0.1:1080" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save proxy" }));

    expect(
      screen.getByText("Proxy URL must use http:// or https://."),
    ).not.toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("removes only the selected provider proxy", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <ProviderProxyConfiguration
        provider="google"
        settings={
          {
            providerSettings: {
              google: {
                apiKey: { value: "google-key" },
                proxyUrl: { value: "http://127.0.0.1:10808" },
              },
              anthropic: { apiKey: { value: "anthropic-key" } },
            },
          } as any
        }
        updateSettings={updateSettings}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Remove provider proxy" }),
    );

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        providerSettings: {
          google: {
            apiKey: { value: "google-key" },
            proxyUrl: undefined,
          },
          anthropic: { apiKey: { value: "anthropic-key" } },
        },
      }),
    );
  });
});
