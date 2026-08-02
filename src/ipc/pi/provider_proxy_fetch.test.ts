// @vitest-environment node
import { afterAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const originalFetch = globalThis.fetch;
  const directFetch = vi.fn(async () => new Response("direct"));
  globalThis.fetch = directFetch;
  return {
    originalFetch,
    directFetch,
    fetch: vi.fn<
      (
        input: string | URL,
        init?: RequestInit & { dispatcher?: unknown },
      ) => Promise<Response>
    >(async () => new Response("ok")),
    proxyAgent: vi.fn(function (
      this: { proxyUrl: string },
      options: string | { uri: string },
    ) {
      this.proxyUrl = typeof options === "string" ? options : options.uri;
    }),
  };
});

vi.mock("undici", () => ({
  fetch: mocks.fetch,
  ProxyAgent: mocks.proxyAgent,
}));

import { runWithProviderProxy } from "./provider_proxy_fetch";

afterAll(() => {
  globalThis.fetch = mocks.originalFetch;
  delete (globalThis as Record<PropertyKey, unknown>)[
    Symbol.for("dyad.providerProxyFetch")
  ];
});

describe("provider proxy fetch context", () => {
  it("uses the original fetch when no provider proxy is active", async () => {
    await globalThis.fetch("https://provider-direct.test");

    expect(mocks.directFetch).toHaveBeenCalledWith(
      "https://provider-direct.test",
      undefined,
    );
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("keeps concurrent provider proxy contexts isolated across awaits", async () => {
    await Promise.all([
      runWithProviderProxy("http://proxy-one.test:8080", async () => {
        await Promise.resolve();
        await globalThis.fetch("https://provider-one.test");
      }),
      runWithProviderProxy("https://proxy-two.test:8443", async () => {
        await Promise.resolve();
        await globalThis.fetch("https://provider-two.test");
      }),
    ]);

    const calls = mocks.fetch.mock.calls.map(([input, init]) => {
      const dispatcher = init?.dispatcher as { proxyUrl: string } | undefined;
      return { input, proxyUrl: dispatcher?.proxyUrl };
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          input: "https://provider-one.test",
          proxyUrl: "http://proxy-one.test:8080/",
        },
        {
          input: "https://provider-two.test",
          proxyUrl: "https://proxy-two.test:8443/",
        },
      ]),
    );
  });
});
