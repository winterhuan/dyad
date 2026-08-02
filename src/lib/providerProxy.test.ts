import { describe, expect, it } from "vitest";

import {
  getProviderProxyUrl,
  normalizeProviderProxyUrl,
  parseProviderProxyUrl,
} from "./providerProxy";

describe("provider proxy configuration", () => {
  it.each([
    "http://127.0.0.1:10808",
    "https://proxy.example.com:8443",
    "http://user:password@127.0.0.1:1080",
  ])("accepts supported proxy URL %s", (proxyUrl) => {
    expect(parseProviderProxyUrl(proxyUrl).toString()).toBe(proxyUrl + "/");
  });

  it("rejects unsupported proxy protocols", () => {
    expect(() => parseProviderProxyUrl("ftp://proxy.example.com")).toThrow(
      "http:// or https://",
    );
  });

  it("rejects SOCKS proxies that are unsupported by some provider SDKs", () => {
    expect(() => parseProviderProxyUrl("socks5://127.0.0.1:1080")).toThrow(
      "http:// or https://",
    );
  });

  it("normalizes and reads a provider-scoped proxy", () => {
    const settings = {
      providerSettings: {
        google: { proxyUrl: { value: "  http://127.0.0.1:10808  " } },
      },
    } as any;

    expect(normalizeProviderProxyUrl("  http://proxy  ")).toBe("http://proxy");
    expect(getProviderProxyUrl(settings, "google")).toBe(
      "http://127.0.0.1:10808",
    );
    expect(getProviderProxyUrl(settings, "anthropic")).toBeUndefined();
    expect(
      getProviderProxyUrl(
        {} as Parameters<typeof getProviderProxyUrl>[0],
        "google",
      ),
    ).toBeUndefined();
  });
});
