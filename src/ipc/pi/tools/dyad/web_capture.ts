import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { parseHTML } from "linkedom";

import type { PublicWebResource } from "./web_access";
import { fetchPublicResource } from "./web_access";

const MAX_STYLESHEETS = 8;
const MAX_IMAGES = 12;
const MAX_STYLESHEET_BYTES = 512 * 1024;
const MAX_IMAGE_BYTES = 1024 * 1024;
const VIEWPORT = { width: 1440, height: 1000 };

type ResourceFetcher = (
  url: string,
  options: { accept?: string; maxBytes?: number; signal?: AbortSignal },
) => Promise<PublicWebResource>;

function absoluteUrl(value: string | null, baseUrl: string): string | null {
  if (!value || value.startsWith("data:")) return value;
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export async function buildStaticWebsiteSnapshot(
  rawUrl: string,
  signal?: AbortSignal,
  fetchResource: ResourceFetcher = fetchPublicResource,
): Promise<string> {
  const page = await fetchResource(rawUrl, {
    accept: "text/html,application/xhtml+xml",
    maxBytes: 2 * 1024 * 1024,
    signal,
  });
  if (
    !page.contentType.includes("html") &&
    !page.contentType.includes("xhtml")
  ) {
    throw new Error("Website screenshot requires an HTML page.");
  }
  const { document } = parseHTML(page.body.toString("utf8"));
  document
    .querySelectorAll(
      "script, iframe, frame, object, embed, form, input, textarea, select, button, meta[http-equiv='refresh']",
    )
    .forEach((element) => element.remove());

  const stylesheetLinks = [
    ...document.querySelectorAll("link[rel~='stylesheet'][href]"),
  ].slice(0, MAX_STYLESHEETS);
  for (const link of stylesheetLinks) {
    signal?.throwIfAborted();
    const href = absoluteUrl(link.getAttribute("href"), page.url);
    if (!href) {
      link.remove();
      continue;
    }
    try {
      const resource = await fetchResource(href, {
        accept: "text/css,text/plain",
        maxBytes: MAX_STYLESHEET_BYTES,
        signal,
      });
      if (!resource.contentType.includes("css")) {
        link.remove();
        continue;
      }
      const style = document.createElement("style");
      style.textContent = resource.body.toString("utf8");
      link.replaceWith(style);
    } catch {
      link.remove();
    }
  }
  document.querySelectorAll("link").forEach((element) => element.remove());

  const images = [...document.querySelectorAll("img[src]")];
  for (const [index, image] of images.entries()) {
    image.removeAttribute("srcset");
    image.removeAttribute("sizes");
    if (index >= MAX_IMAGES) {
      image.removeAttribute("src");
      continue;
    }
    const src = absoluteUrl(image.getAttribute("src"), page.url);
    if (!src || src.startsWith("data:")) continue;
    try {
      const resource = await fetchResource(src, {
        accept: "image/*",
        maxBytes: MAX_IMAGE_BYTES,
        signal,
      });
      if (!resource.contentType.startsWith("image/")) {
        image.removeAttribute("src");
        continue;
      }
      image.setAttribute(
        "src",
        `data:${resource.contentType.split(";")[0]};base64,${resource.body.toString("base64")}`,
      );
    } catch {
      image.removeAttribute("src");
    }
  }
  document
    .querySelectorAll("source, video, audio")
    .forEach((element) => element.remove());

  const csp = document.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute(
    "content",
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;",
  );
  document.head.prepend(csp);
  const baseStyle = document.createElement("style");
  baseStyle.textContent =
    "html,body{min-height:100%;}body{margin:0;}*{animation:none!important;transition:none!important;}";
  document.head.append(baseStyle);
  return document.toString();
}

function waitForPaint(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, 150);
    const onAbort = () => finish(signal?.reason ?? new Error("Cancelled"));
    function finish(error?: unknown) {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    }
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export async function capturePublicWebsiteScreenshot(
  rawUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const html = await buildStaticWebsiteSnapshot(rawUrl, signal);
  await app.whenReady();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-web-capture-"));
  const htmlPath = path.join(tempDir, "snapshot.html");
  await fs.writeFile(htmlPath, html, "utf8");
  const window = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: `dyad-web-capture-${randomUUID()}`,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  try {
    await window.loadFile(htmlPath);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    await waitForPaint(signal);
    signal?.throwIfAborted();
    const image = await window.capturePage({
      x: 0,
      y: 0,
      ...VIEWPORT,
    });
    if (image.isEmpty()) throw new Error("Captured website image was empty.");
    return image.toDataURL();
  } finally {
    if (!window.isDestroyed()) window.destroy();
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
