import { useEffect, useState } from "react";
import { Server, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseOpenAIBaseUrl } from "@/lib/openaiBaseUrl";
import type { RegularProviderSetting, UserSettings } from "@/lib/schemas";

interface OpenAIBaseUrlConfigurationProps {
  settings: UserSettings | null | undefined;
  updateSettings: (settings: Partial<UserSettings>) => Promise<UserSettings>;
}

export function OpenAIBaseUrlConfiguration({
  settings,
  updateSettings,
}: OpenAIBaseUrlConfigurationProps) {
  const openAISettings = settings?.providerSettings?.openai as
    | RegularProviderSetting
    | undefined;
  const existingBaseUrl = openAISettings?.baseUrl ?? "";
  const [baseUrlInput, setBaseUrlInput] = useState(existingBaseUrl);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setBaseUrlInput(existingBaseUrl);
    setError(null);
    setSuccessMessage(null);
  }, [existingBaseUrl]);

  const saveBaseUrl = async () => {
    let baseUrl: string;
    try {
      baseUrl = parseOpenAIBaseUrl(baseUrlInput);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Invalid Base URL.",
      );
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          openai: {
            ...settings?.providerSettings?.openai,
            baseUrl,
          },
        },
      });
      setBaseUrlInput(baseUrl);
      setSuccessMessage("Base URL saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save Base URL.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const resetBaseUrl = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          openai: {
            ...settings?.providerSettings?.openai,
            baseUrl: undefined,
          },
        },
      });
      setBaseUrlInput("");
      setSuccessMessage("Using the default OpenAI Base URL.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to reset Base URL.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mb-6 border-b pb-6">
      <div className="mb-3 flex items-center gap-2">
        <Server className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">OpenAI Base URL</h2>
        <span className="text-xs text-muted-foreground">
          {existingBaseUrl ? "Custom" : "Default"}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="url"
          aria-label="OpenAI Base URL"
          value={baseUrlInput}
          onChange={(event) => {
            setBaseUrlInput(event.target.value);
            setError(null);
            setSuccessMessage(null);
          }}
          placeholder="https://api.openai.com/v1"
          disabled={isSaving}
        />
        <Button
          type="button"
          onClick={saveBaseUrl}
          disabled={isSaving || !baseUrlInput.trim()}
        >
          {isSaving ? "Saving..." : "Save URL"}
        </Button>
        {existingBaseUrl && (
          <Button
            type="button"
            variant="outline"
            onClick={resetBaseUrl}
            disabled={isSaving}
            aria-label="Reset OpenAI Base URL"
            title="Reset OpenAI Base URL"
          >
            <Trash2 />
          </Button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {successMessage && (
        <p className="mt-2 text-xs text-green-600 dark:text-green-400">
          {successMessage}
        </p>
      )}
    </section>
  );
}
