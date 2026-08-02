import { useEffect, useState } from "react";
import { Network, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { UserSettings } from "@/lib/schemas";
import {
  normalizeProviderProxyUrl,
  parseProviderProxyUrl,
} from "@/lib/providerProxy";

interface ProviderProxyConfigurationProps {
  provider: string;
  settings: UserSettings | null | undefined;
  updateSettings: (settings: Partial<UserSettings>) => Promise<UserSettings>;
}

export function ProviderProxyConfiguration({
  provider,
  settings,
  updateSettings,
}: ProviderProxyConfigurationProps) {
  const [proxyInput, setProxyInput] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const hasProxy = Boolean(
    settings?.providerSettings?.[provider]?.proxyUrl?.value,
  );

  useEffect(() => {
    setProxyInput("");
    setError(null);
    setSuccessMessage(null);
  }, [provider]);

  const saveProxy = async () => {
    const proxyUrl = normalizeProviderProxyUrl(proxyInput);
    try {
      parseProviderProxyUrl(proxyUrl);
    } catch (validationError) {
      setError(
        validationError instanceof Error
          ? validationError.message
          : "Invalid proxy URL.",
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
          [provider]: {
            ...settings?.providerSettings?.[provider],
            proxyUrl: { value: proxyUrl },
          },
        },
      });
      setProxyInput("");
      setSuccessMessage("Proxy saved.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to save proxy.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const removeProxy = async () => {
    setIsSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await updateSettings({
        providerSettings: {
          ...settings?.providerSettings,
          [provider]: {
            ...settings?.providerSettings?.[provider],
            proxyUrl: undefined,
          },
        },
      });
      setProxyInput("");
      setSuccessMessage("Proxy removed.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Failed to remove proxy.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="mb-6 border-b pb-6">
      <div className="mb-3 flex items-center gap-2">
        <Network className="size-4 text-muted-foreground" />
        <h2 className="text-base font-semibold">Provider proxy</h2>
        <span className="text-xs text-muted-foreground">
          {hasProxy ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="password"
          aria-label="Provider proxy URL"
          value={proxyInput}
          onChange={(event) => {
            setProxyInput(event.target.value);
            setError(null);
            setSuccessMessage(null);
          }}
          placeholder={
            hasProxy
              ? "Enter a replacement proxy URL"
              : "http://127.0.0.1:10808"
          }
          disabled={isSaving}
        />
        <Button
          type="button"
          onClick={saveProxy}
          disabled={isSaving || !proxyInput.trim()}
        >
          {isSaving ? "Saving..." : "Save proxy"}
        </Button>
        {hasProxy && (
          <Button
            type="button"
            variant="outline"
            onClick={removeProxy}
            disabled={isSaving}
            aria-label="Remove provider proxy"
            title="Remove provider proxy"
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
