import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type {
  SetUserSettingsInput,
  WebSearchCredentialProvider,
  WebSearchCredentialStatus,
} from "@/ipc/types/settings";
import { searchWeb } from "@/ipc/pi/tools/dyad/web_access";
import {
  WEB_SEARCH_BRAVE_PROVIDER_ID,
  WEB_SEARCH_EXA_PROVIDER_ID,
  type UserSettings,
} from "@/lib/schemas";
import {
  findInvalidProviderApiKeyCharacter,
  formatInvalidProviderApiKeyMessage,
  normalizeProviderApiKeyInput,
} from "@/lib/providerApiKey";
import {
  readEffectiveSettings,
  readSettings,
  writeSettings,
} from "@/main/settings";

const WEB_SEARCH_PROVIDER_IDS = {
  exa: WEB_SEARCH_EXA_PROVIDER_ID,
  brave: WEB_SEARCH_BRAVE_PROVIDER_ID,
} as const;

const WEB_SEARCH_PROVIDER_NAMES = {
  exa: "Exa",
  brave: "Brave Search",
} as const;

const RESERVED_WEB_SEARCH_PROVIDER_IDS = new Set<string>(
  Object.values(WEB_SEARCH_PROVIDER_IDS),
);

function getProviderId(provider: WebSearchCredentialProvider) {
  return WEB_SEARCH_PROVIDER_IDS[provider];
}

function getStoredApiKey(
  settings: UserSettings,
  provider: WebSearchCredentialProvider,
): string | undefined {
  return settings.providerSettings[
    getProviderId(provider)
  ]?.apiKey?.value?.trim();
}

export function getWebSearchCredentialStatus(
  settings: UserSettings = readSettings(),
): WebSearchCredentialStatus {
  return {
    hasExaKey: Boolean(getStoredApiKey(settings, "exa")),
    hasBraveKey: Boolean(getStoredApiKey(settings, "brave")),
  };
}

export function redactWebSearchCredentials(
  settings: UserSettings,
): UserSettings {
  const providerSettings = { ...settings.providerSettings };
  for (const providerId of RESERVED_WEB_SEARCH_PROVIDER_IDS) {
    delete providerSettings[providerId];
  }
  return { ...settings, providerSettings };
}

export async function readRendererUserSettings(): Promise<UserSettings> {
  return redactWebSearchCredentials(await readEffectiveSettings());
}

export async function writeRendererUserSettings(
  settings: SetUserSettingsInput,
): Promise<UserSettings> {
  const incomingProviderSettings = settings.providerSettings;
  if (incomingProviderSettings) {
    for (const providerId of RESERVED_WEB_SEARCH_PROVIDER_IDS) {
      if (Object.hasOwn(incomingProviderSettings, providerId)) {
        throw new DyadError(
          "Web search API keys must be updated through the dedicated credential settings.",
          DyadErrorKind.Validation,
        );
      }
    }

    const currentSettings = readSettings();
    const providerSettings = { ...incomingProviderSettings };
    for (const providerId of RESERVED_WEB_SEARCH_PROVIDER_IDS) {
      const currentProvider = currentSettings.providerSettings[providerId];
      if (currentProvider) {
        providerSettings[providerId] = currentProvider;
      }
    }
    writeSettings({ ...settings, providerSettings });
  } else {
    writeSettings(settings);
  }

  return readRendererUserSettings();
}

export function setWebSearchApiKey({
  provider,
  apiKey,
}: {
  provider: WebSearchCredentialProvider;
  apiKey: string;
}): WebSearchCredentialStatus {
  const normalizedApiKey = normalizeProviderApiKeyInput(apiKey);
  if (!normalizedApiKey) {
    throw new DyadError("API key cannot be empty.", DyadErrorKind.Validation);
  }
  const invalidCharacter = findInvalidProviderApiKeyCharacter(normalizedApiKey);
  if (invalidCharacter) {
    throw new DyadError(
      formatInvalidProviderApiKeyMessage(
        WEB_SEARCH_PROVIDER_NAMES[provider],
        invalidCharacter,
      ),
      DyadErrorKind.Validation,
    );
  }

  const settings = readSettings();
  const providerId = getProviderId(provider);
  writeSettings({
    providerSettings: {
      ...settings.providerSettings,
      [providerId]: {
        ...settings.providerSettings[providerId],
        apiKey: { value: normalizedApiKey },
      },
    },
  });
  return getWebSearchCredentialStatus(readSettings());
}

export function deleteWebSearchApiKey({
  provider,
}: {
  provider: WebSearchCredentialProvider;
}): WebSearchCredentialStatus {
  const settings = readSettings();
  const providerSettings = { ...settings.providerSettings };
  delete providerSettings[getProviderId(provider)];
  writeSettings({ providerSettings });
  return getWebSearchCredentialStatus(readSettings());
}

export async function testWebSearchProvider({
  provider,
}: {
  provider: WebSearchCredentialProvider;
}): Promise<{ ok: true }> {
  const settings = readSettings();
  const apiKey = getStoredApiKey(settings, provider);
  if (!apiKey) {
    throw new DyadError(
      `${WEB_SEARCH_PROVIDER_NAMES[provider]} API key is not configured.`,
      DyadErrorKind.Precondition,
    );
  }

  await searchWeb(
    { query: "Dyad", numResults: 1 },
    {
      provider,
      ...(provider === "exa" ? { exaApiKey: apiKey } : { braveApiKey: apiKey }),
    },
  );
  return { ok: true };
}
