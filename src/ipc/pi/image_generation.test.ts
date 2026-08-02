// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateImages: vi.fn(),
  getModel: vi.fn(),
  readSettings: vi.fn(),
  runWithProviderProxy: vi.fn(
    (_proxyUrl: string | undefined, callback: () => unknown) => callback(),
  ),
}));

vi.mock("@/ipc/pi/model_runtime", () => ({
  getPiImageModels: () => ({
    generateImages: mocks.generateImages,
    getModel: mocks.getModel,
  }),
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettings,
}));

vi.mock("./provider_proxy_fetch", () => ({
  runWithProviderProxy: mocks.runWithProviderProxy,
}));

import { generateImage } from "./image_generation";

describe("generateImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModel.mockReturnValue({
      provider: "openrouter",
      id: "openrouter/auto",
    });
    mocks.readSettings.mockReturnValue({
      providerSettings: {
        openrouter: { proxyUrl: { value: "http://proxy.test:8080" } },
      },
    });
    mocks.generateImages.mockResolvedValue({
      output: [{ type: "image", data: "base64", mimeType: "image/png" }],
      stopReason: "stop",
    });
  });

  it("runs OpenRouter image generation through its provider proxy", async () => {
    await expect(generateImage("A lighthouse")).resolves.toMatchObject({
      data: "base64",
      mimeType: "image/png",
    });

    expect(mocks.runWithProviderProxy).toHaveBeenCalledWith(
      "http://proxy.test:8080",
      expect.any(Function),
    );
    expect(mocks.generateImages).toHaveBeenCalledOnce();
  });
});
