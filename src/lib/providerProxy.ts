import type { UserSettings } from "./schemas";

const SUPPORTED_PROXY_PROTOCOLS = new Set(["http:", "https:"]);

export function normalizeProviderProxyUrl(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function parseProviderProxyUrl(value: string): URL {
  const normalized = normalizeProviderProxyUrl(value);
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      "Enter a valid proxy URL, for example http://127.0.0.1:10808.",
    );
  }

  if (!SUPPORTED_PROXY_PROTOCOLS.has(url.protocol)) {
    throw new Error("Proxy URL must use http:// or https://.");
  }
  if (!url.hostname) {
    throw new Error("Proxy URL must include a hostname.");
  }
  return url;
}

export function getProviderProxyUrl(
  settings: UserSettings,
  provider: string,
): string | undefined {
  const value = normalizeProviderProxyUrl(
    settings.providerSettings?.[provider]?.proxyUrl?.value,
  );
  return value || undefined;
}
