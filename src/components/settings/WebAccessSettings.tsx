import { useState } from "react";
import { KeyRound, RefreshCw, Save, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/useSettings";
import { ipc } from "@/ipc/types";
import {
  WEB_SEARCH_BRAVE_PROVIDER_ID,
  WEB_SEARCH_EXA_PROVIDER_ID,
} from "@/lib/schemas";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

type SearchProviderId =
  | typeof WEB_SEARCH_EXA_PROVIDER_ID
  | typeof WEB_SEARCH_BRAVE_PROVIDER_ID;

function ApiKeySetting({
  label,
  providerId,
  hasSavedValue,
  isUpdating,
  isTesting,
  onSave,
  onDelete,
  onTest,
}: {
  label: string;
  providerId: SearchProviderId;
  hasSavedValue: boolean;
  isUpdating: boolean;
  isTesting: boolean;
  onSave: (providerId: SearchProviderId, value: string) => Promise<unknown>;
  onDelete: (providerId: SearchProviderId) => Promise<unknown>;
  onTest: (providerId: SearchProviderId) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");

  const save = async () => {
    const apiKey = value.trim();
    if (!apiKey) return;
    try {
      await onSave(providerId, apiKey);
      setValue("");
      showSuccess(`${label} saved`);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : `Failed to save ${label}`,
      );
    }
  };

  const remove = async () => {
    try {
      await onDelete(providerId);
      showSuccess(`${label} deleted`);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : `Failed to delete ${label}`,
      );
    }
  };

  const test = async () => {
    try {
      await onTest(providerId);
      showSuccess(`${label} connection succeeded`);
    } catch (error) {
      showError(
        error instanceof Error ? error.message : `Failed to test ${label}`,
      );
    }
  };

  return (
    <div className="space-y-2 border-t border-border/60 pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${providerId}-key`}>{label}</Label>
        <span className="font-mono text-xs text-muted-foreground">
          {hasSavedValue ? "Configured" : "Not configured"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={`${providerId}-key`}
            aria-label={`${label} value`}
            type="password"
            autoComplete="off"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={
              hasSavedValue ? "Enter a replacement key" : "Enter API key"
            }
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={save}
          disabled={isUpdating || isTesting || !value.trim()}
        >
          <Save />
          Save
        </Button>
        {hasSavedValue && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={test}
            disabled={isUpdating || isTesting}
          >
            <RefreshCw className={isTesting ? "animate-spin" : undefined} />
            Test
          </Button>
        )}
        {hasSavedValue && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={remove}
            disabled={isUpdating || isTesting}
          >
            <Trash2 />
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

export function WebAccessSettings() {
  const { settings, updateSettings } = useSettings();
  const queryClient = useQueryClient();
  const enabled = settings?.enableWebAccess === true;
  const credentialsQuery = useQuery({
    queryKey: queryKeys.settings.webSearchCredentials,
    queryFn: () => ipc.settings.getWebSearchCredentialStatus(),
    meta: { showErrorToast: true },
  });
  const credentialMutation = useMutation({
    mutationFn: ({
      providerId,
      value,
    }: {
      providerId: SearchProviderId;
      value?: string;
    }) => {
      const provider =
        providerId === WEB_SEARCH_EXA_PROVIDER_ID ? "exa" : "brave";
      return value === undefined
        ? ipc.settings.deleteWebSearchApiKey({ provider })
        : ipc.settings.setWebSearchApiKey({ provider, apiKey: value });
    },
    onSuccess: (status) => {
      queryClient.setQueryData(queryKeys.settings.webSearchCredentials, status);
    },
  });
  const testMutation = useMutation({
    mutationFn: (providerId: SearchProviderId) =>
      ipc.settings.testWebSearchProvider({
        provider: providerId === WEB_SEARCH_EXA_PROVIDER_ID ? "exa" : "brave",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label htmlFor="web-access">Web access</Label>
          <p className="text-[13px] text-muted-foreground">
            Allow the agent to search and read public web pages.
          </p>
        </div>
        <Switch
          id="web-access"
          aria-label="Web access"
          checked={enabled}
          onCheckedChange={(checked) =>
            updateSettings({ enableWebAccess: checked })
          }
        />
      </div>

      {enabled && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-4">
            <Label htmlFor="web-search-provider">Search provider</Label>
            <Select
              value={settings?.webSearchProvider ?? "auto"}
              onValueChange={(value) => {
                if (value === "auto" || value === "exa" || value === "brave") {
                  updateSettings({ webSearchProvider: value });
                }
              }}
            >
              <SelectTrigger id="web-search-provider" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto</SelectItem>
                <SelectItem value="exa">Exa</SelectItem>
                <SelectItem value="brave">Brave</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <ApiKeySetting
            label="Exa API key"
            providerId={WEB_SEARCH_EXA_PROVIDER_ID}
            hasSavedValue={credentialsQuery.data?.hasExaKey === true}
            isUpdating={credentialMutation.isPending}
            isTesting={
              testMutation.isPending &&
              testMutation.variables === WEB_SEARCH_EXA_PROVIDER_ID
            }
            onSave={(providerId, value) =>
              credentialMutation.mutateAsync({ providerId, value })
            }
            onDelete={(providerId) =>
              credentialMutation.mutateAsync({ providerId })
            }
            onTest={(providerId) => testMutation.mutateAsync(providerId)}
          />
          <ApiKeySetting
            label="Brave Search API key"
            providerId={WEB_SEARCH_BRAVE_PROVIDER_ID}
            hasSavedValue={credentialsQuery.data?.hasBraveKey === true}
            isUpdating={credentialMutation.isPending}
            isTesting={
              testMutation.isPending &&
              testMutation.variables === WEB_SEARCH_BRAVE_PROVIDER_ID
            }
            onSave={(providerId, value) =>
              credentialMutation.mutateAsync({ providerId, value })
            }
            onDelete={(providerId) =>
              credentialMutation.mutateAsync({ providerId })
            }
            onTest={(providerId) => testMutation.mutateAsync(providerId)}
          />
        </div>
      )}
    </div>
  );
}
