import type { ImageContent } from "@earendil-works/pi-ai";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { LargeLanguageModel, UserSettings } from "@/lib/schemas";
import { getProviderProxyUrl } from "@/lib/providerProxy";
import { readSettings } from "@/main/settings";
import { getPiModels, resolveDyadModel } from "./model_runtime";
import { runWithProviderProxy } from "./provider_proxy_fetch";
import { buildStreamOptions } from "./stream_fn";

export interface ProviderTextGenerationInput {
  systemPrompt: string;
  prompt: string;
  images?: ImageContent[];
  model?: LargeLanguageModel;
  settings?: UserSettings;
  signal?: AbortSignal;
  maxTokens?: number;
  dyadRequestId?: string;
}

export async function generateProviderText(
  input: ProviderTextGenerationInput,
): Promise<string> {
  const settings = input.settings ?? readSettings();
  const selectedModel = input.model ?? settings.selectedModel;
  const model = await resolveDyadModel(selectedModel, { settings });
  const options = await buildStreamOptions(
    selectedModel,
    settings,
    input.dyadRequestId,
  );
  const content = [
    { type: "text" as const, text: input.prompt },
    ...(input.images ?? []),
  ];
  const result = await runWithProviderProxy(
    getProviderProxyUrl(settings, selectedModel.provider),
    () =>
      getPiModels()
        .streamSimple(
          model,
          {
            systemPrompt: input.systemPrompt,
            messages: [{ role: "user", content, timestamp: Date.now() }],
          },
          {
            ...options,
            ...(input.maxTokens === undefined
              ? {}
              : { maxTokens: input.maxTokens }),
            signal: input.signal,
            maxRetries: 2,
          },
        )
        .result(),
  );
  if (result.stopReason === "error") {
    throw new DyadError(
      "Text generation failed at the selected provider.",
      DyadErrorKind.External,
    );
  }
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
  if (!text) {
    throw new DyadError(
      "The selected model returned an empty response.",
      DyadErrorKind.External,
    );
  }
  return text;
}
