// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { whenReady: vi.fn() },
  BrowserWindow: vi.fn(),
}));

import type { PublicWebResource } from "./web_access";
import { buildStaticWebsiteSnapshot } from "./web_capture";

function resource(
  url: string,
  contentType: string,
  body: string,
): PublicWebResource {
  return { url, contentType, body: Buffer.from(body) };
}

describe("static website snapshots", () => {
  it("removes active content and embeds safely fetched styles and images", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === "https://example.com/") {
        return resource(
          url,
          "text/html",
          '<html><head><link rel="stylesheet" href="/app.css"><script>alert(1)</script></head><body><form><input></form><img src="/hero.png"><iframe src="https://internal.example"></iframe></body></html>',
        );
      }
      if (url === "https://example.com/app.css") {
        return resource(url, "text/css", "body { color: rgb(1, 2, 3); }");
      }
      if (url === "https://example.com/hero.png") {
        return resource(url, "image/png", "image-bytes");
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const html = await buildStaticWebsiteSnapshot(
      "https://example.com/",
      undefined,
      fetcher,
    );

    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("rgb(1, 2, 3)");
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("<form");
  });
});
