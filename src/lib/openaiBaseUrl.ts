import type { RegularProviderSetting, UserSettings } from "./schemas";

export function normalizeOpenAIBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function parseOpenAIBaseUrl(value: string): string {
  const baseUrl = normalizeOpenAIBaseUrl(value);
  let parsed: URL;

  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(
      "Enter a valid Base URL, for example https://api.openai.com/v1.",
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Base URL must use http:// or https://.");
  }

  return baseUrl;
}

export function getOpenAIBaseUrl(
  settings: Pick<UserSettings, "providerSettings"> | undefined,
): string | undefined {
  const openAISettings = settings?.providerSettings?.openai as
    | RegularProviderSetting
    | undefined;
  const value = openAISettings?.baseUrl;
  return typeof value === "string" && value.trim()
    ? parseOpenAIBaseUrl(value)
    : undefined;
}
