import { describe, expect, it } from "vitest";

import { GenerateThemePromptParamsSchema } from "./templates";

describe("GenerateThemePromptParamsSchema", () => {
  it("accepts provider-ready theme references", () => {
    expect(
      GenerateThemePromptParamsSchema.safeParse({
        inspiration: "High-contrast editorial dashboard",
        websiteUrl: "https://example.com/reference",
        images: [{ data: "AQID", mimeType: "image/png" }],
        generationMode: "high-fidelity",
        model: { provider: "openai", name: "gpt-5" },
      }).success,
    ).toBe(true);
  });

  it("rejects unknown generation modes", () => {
    expect(
      GenerateThemePromptParamsSchema.safeParse({
        inspiration: "Minimal theme",
        generationMode: "pixel-perfect-copy",
      }).success,
    ).toBe(false);
  });

  it("rejects excess images and non-image media", () => {
    expect(
      GenerateThemePromptParamsSchema.safeParse({
        inspiration: "Minimal theme",
        images: Array.from({ length: 6 }, () => ({
          data: "AQID",
          mimeType: "image/png",
        })),
      }).success,
    ).toBe(false);
    expect(
      GenerateThemePromptParamsSchema.safeParse({
        inspiration: "Minimal theme",
        images: [{ data: "AQID", mimeType: "text/html" }],
      }).success,
    ).toBe(false);
  });
});
