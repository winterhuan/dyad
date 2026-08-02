import { describe, expect, it } from "vitest";

import {
  getOpenAIBaseUrl,
  normalizeOpenAIBaseUrl,
  parseOpenAIBaseUrl,
} from "./openaiBaseUrl";

describe("OpenAI Base URL", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizeOpenAIBaseUrl("  https://gateway.example/v1///  ")).toBe(
      "https://gateway.example/v1",
    );
    expect(parseOpenAIBaseUrl(" http://127.0.0.1:4000/v1/ ")).toBe(
      "http://127.0.0.1:4000/v1",
    );
  });

  it("rejects unsupported protocols", () => {
    expect(() => parseOpenAIBaseUrl("ftp://gateway.example/v1")).toThrow(
      "Base URL must use http:// or https://.",
    );
  });

  it("reads only a configured OpenAI Base URL", () => {
    expect(
      getOpenAIBaseUrl({
        providerSettings: {
          openai: { baseUrl: " https://gateway.example/v1/ " },
        },
      } as any),
    ).toBe("https://gateway.example/v1");
    expect(
      getOpenAIBaseUrl({ providerSettings: { openai: {} } } as any),
    ).toBeUndefined();
  });
});
