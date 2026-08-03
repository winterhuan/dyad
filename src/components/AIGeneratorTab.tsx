import { useRef, useState } from "react";
import { ImagePlus, Loader2, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ModelPicker } from "@/components/ModelPicker";
import { useGenerateThemePrompt } from "@/hooks/useCustomThemes";
import { useSettings } from "@/hooks/useSettings";
import { showError } from "@/lib/toast";
import type { LargeLanguageModel } from "@/lib/schemas";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

interface ThemeImage {
  data: string;
  mimeType: string;
  preview: string;
}

export function AIGeneratorTab({
  prompt,
  onPromptChange,
}: {
  prompt: string;
  onPromptChange: (prompt: string) => void;
}) {
  const { t } = useTranslation("home");
  const [inspiration, setInspiration] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [images, setImages] = useState<ThemeImage[]>([]);
  const [generationMode, setGenerationMode] = useState<
    "inspired" | "high-fidelity"
  >("inspired");
  const [themeModel, setThemeModel] = useState<LargeLanguageModel | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generation = useGenerateThemePrompt();
  const { settings } = useSettings();
  const effectiveModel = themeModel ?? settings?.selectedModel;

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files).slice(0, MAX_IMAGES - images.length);
    const next: ThemeImage[] = [];
    for (const file of selected) {
      if (!file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES) {
        showError(t("customTheme.invalidReferenceImage"));
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const data = dataUrl.split(",")[1];
      if (data) next.push({ data, mimeType: file.type, preview: dataUrl });
    }
    setImages((current) => [...current, ...next].slice(0, MAX_IMAGES));
    if (inputRef.current) inputRef.current.value = "";
  };

  const generate = async () => {
    if (!inspiration.trim()) {
      showError(t("customTheme.enterInspiration"));
      return;
    }
    try {
      const result = await generation.mutateAsync({
        inspiration: inspiration.trim(),
        websiteUrl: websiteUrl.trim() || undefined,
        images: images.map(({ data, mimeType }) => ({ data, mimeType })),
        generationMode,
        model: effectiveModel,
      });
      onPromptChange(result.prompt);
    } catch (error) {
      showError(
        t("customTheme.failedGenerate", {
          error: error instanceof Error ? error.message : "Unknown error",
        }),
      );
    }
  };

  return (
    <div className="space-y-4 mt-3">
      <div className="space-y-2">
        <Label htmlFor="theme-inspiration">
          {t("customTheme.inspiration")}
        </Label>
        <Textarea
          id="theme-inspiration"
          value={inspiration}
          onChange={(event) => setInspiration(event.target.value)}
          placeholder={t("customTheme.inspirationPlaceholder")}
          className="min-h-24"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="theme-website">
          {t("customTheme.websiteOptional")}
        </Label>
        <Input
          id="theme-website"
          type="url"
          value={websiteUrl}
          onChange={(event) => setWebsiteUrl(event.target.value)}
          placeholder="https://example.com"
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>{t("customTheme.generationMode")}</Label>
          <ToggleGroup
            value={[generationMode]}
            onValueChange={(values) => {
              const value = values.at(-1);
              if (value === "inspired" || value === "high-fidelity") {
                setGenerationMode(value);
              }
            }}
            variant="outline"
            className="w-full"
          >
            <ToggleGroupItem value="inspired">
              {t("customTheme.inspired")}
            </ToggleGroupItem>
            <ToggleGroupItem value="high-fidelity">
              {t("customTheme.highFidelity")}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="space-y-2">
          <Label>{t("customTheme.generationModel")}</Label>
          {effectiveModel && (
            <div className="flex h-9 items-center rounded-md border px-1">
              <ModelPicker
                value={effectiveModel}
                onValueChange={setThemeModel}
              />
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t("customTheme.referenceImages")}</Label>
        <div className="flex flex-wrap items-center gap-2">
          {images.map((image, index) => (
            <div
              key={`${image.preview.slice(-20)}-${index}`}
              className="relative"
            >
              <img
                src={image.preview}
                alt=""
                className="size-16 rounded-md border object-cover"
              />
              <button
                type="button"
                aria-label={t("customTheme.removeReferenceImage")}
                onClick={() =>
                  setImages((current) => current.filter((_, i) => i !== index))
                }
                className="absolute -right-1 -top-1 rounded-full bg-background border p-0.5"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => inputRef.current?.click()}
              title={t("customTheme.addReferenceImages")}
            >
              <ImagePlus className="size-4" />
            </Button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(event) => void addImages(event.target.files)}
          />
        </div>
      </div>
      <Button
        type="button"
        variant="secondary"
        onClick={() => void generate()}
        disabled={generation.isPending || !inspiration.trim()}
        className="w-full"
      >
        {generation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {generation.isPending
          ? t("customTheme.generating")
          : t("customTheme.generate")}
      </Button>
      {prompt && (
        <div className="space-y-2">
          <Label htmlFor="generated-theme-prompt">
            {t("customTheme.generatedPrompt")}
          </Label>
          <Textarea
            id="generated-theme-prompt"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            className="min-h-40 font-mono text-sm"
          />
        </div>
      )}
    </div>
  );
}
