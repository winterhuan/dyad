import { createTypedHandler } from "./base";
import { settingsContracts } from "../types/settings";
import { validateProviderApiKey } from "../services/provider_api_key_validation_service";
import {
  deleteWebSearchApiKey,
  getWebSearchCredentialStatus,
  readRendererUserSettings,
  setWebSearchApiKey,
  testWebSearchProvider,
  writeRendererUserSettings,
} from "../services/web_search_settings_service";

export function registerSettingsHandlers() {
  // Note: Settings handlers intentionally use createTypedHandler without logging
  // to avoid logging sensitive data (API keys, tokens, etc.) from args/return values.

  createTypedHandler(settingsContracts.getUserSettings, async () => {
    return readRendererUserSettings();
  });

  createTypedHandler(settingsContracts.setUserSettings, async (_, settings) => {
    return writeRendererUserSettings(settings);
  });

  createTypedHandler(
    settingsContracts.validateProviderApiKey,
    async (_, params) => {
      return validateProviderApiKey(params);
    },
  );

  createTypedHandler(settingsContracts.getWebSearchCredentialStatus, async () =>
    getWebSearchCredentialStatus(),
  );

  createTypedHandler(settingsContracts.setWebSearchApiKey, async (_, params) =>
    setWebSearchApiKey(params),
  );

  createTypedHandler(
    settingsContracts.deleteWebSearchApiKey,
    async (_, params) => deleteWebSearchApiKey(params),
  );

  createTypedHandler(
    settingsContracts.testWebSearchProvider,
    async (_, params) => testWebSearchProvider(params),
  );
}
