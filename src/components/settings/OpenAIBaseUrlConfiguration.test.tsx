import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OpenAIBaseUrlConfiguration } from "./OpenAIBaseUrlConfiguration";

describe("OpenAIBaseUrlConfiguration", () => {
  it("normalizes the URL and preserves the API key and proxy", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <OpenAIBaseUrlConfiguration
        settings={
          {
            providerSettings: {
              openai: {
                apiKey: { value: "openai-key" },
                proxyUrl: { value: "http://127.0.0.1:10808" },
              },
            },
          } as any
        }
        updateSettings={updateSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("OpenAI Base URL"), {
      target: { value: "  https://gateway.example/v1///  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save URL" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        providerSettings: {
          openai: {
            apiKey: { value: "openai-key" },
            proxyUrl: { value: "http://127.0.0.1:10808" },
            baseUrl: "https://gateway.example/v1",
          },
        },
      }),
    );
  });

  it("rejects unsupported protocols before saving", () => {
    const updateSettings = vi.fn();
    render(
      <OpenAIBaseUrlConfiguration
        settings={{ providerSettings: {} } as any}
        updateSettings={updateSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("OpenAI Base URL"), {
      target: { value: "ftp://gateway.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save URL" }));

    expect(
      screen.getByText("Base URL must use http:// or https://."),
    ).not.toBeNull();
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("resets only the OpenAI Base URL", async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    render(
      <OpenAIBaseUrlConfiguration
        settings={
          {
            providerSettings: {
              openai: {
                apiKey: { value: "openai-key" },
                proxyUrl: { value: "http://127.0.0.1:10808" },
                baseUrl: "https://gateway.example/v1",
              },
              anthropic: { apiKey: { value: "anthropic-key" } },
            },
          } as any
        }
        updateSettings={updateSettings}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Reset OpenAI Base URL" }),
    );

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        providerSettings: {
          openai: {
            apiKey: { value: "openai-key" },
            proxyUrl: { value: "http://127.0.0.1:10808" },
            baseUrl: undefined,
          },
          anthropic: { apiKey: { value: "anthropic-key" } },
        },
      }),
    );
  });
});
