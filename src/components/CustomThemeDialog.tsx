import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useCreateCustomTheme } from "@/hooks/useCustomThemes";
import { showError } from "@/lib/toast";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AIGeneratorTab } from "./AIGeneratorTab";

interface CustomThemeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onThemeCreated?: (themeId: number) => void; // callback when theme is created
}

export function CustomThemeDialog({
  open,
  onOpenChange,
  onThemeCreated,
}: CustomThemeDialogProps) {
  const { t } = useTranslation("home");
  const [manualName, setManualName] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualPrompt, setManualPrompt] = useState("");
  const [themeTab, setThemeTab] = useState<"manual" | "ai">("manual");

  const createThemeMutation = useCreateCustomTheme();

  const resetForm = useCallback(() => {
    setManualName("");
    setManualDescription("");
    setManualPrompt("");
    setThemeTab("manual");
  }, []);

  const handleClose = useCallback(async () => {
    resetForm();
    onOpenChange(false);
  }, [onOpenChange, resetForm]);

  const handleSave = useCallback(async () => {
    if (!manualName.trim()) {
      showError("Please enter a theme name");
      return;
    }
    if (!manualPrompt.trim()) {
      showError("Please enter a theme prompt");
      return;
    }

    try {
      const createdTheme = await createThemeMutation.mutateAsync({
        name: manualName.trim(),
        description: manualDescription.trim() || undefined,
        prompt: manualPrompt.trim(),
      });
      toast.success("Custom theme created successfully");
      onThemeCreated?.(createdTheme.id);
      await handleClose();
    } catch (error) {
      showError(
        `Failed to create theme: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }, [
    manualName,
    manualDescription,
    manualPrompt,
    createThemeMutation,
    onThemeCreated,
    handleClose,
  ]);

  const isSaving = createThemeMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Custom Theme</DialogTitle>
          <DialogDescription>
            Create a reusable theme prompt for your apps.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label htmlFor="manual-name">Theme Name</Label>
            <Input
              id="manual-name"
              placeholder="My Custom Theme"
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manual-description">Description (optional)</Label>
            <Input
              id="manual-description"
              placeholder="A brief description of your theme"
              value={manualDescription}
              onChange={(e) => setManualDescription(e.target.value)}
            />
          </div>

          <Tabs
            value={themeTab}
            onValueChange={(value) => {
              if (value === "manual" || value === "ai") setThemeTab(value);
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="manual">
                {t("customTheme.manualTab")}
              </TabsTrigger>
              <TabsTrigger value="ai">{t("customTheme.aiTab")}</TabsTrigger>
            </TabsList>
            <TabsContent value="manual">
              <div className="space-y-2">
                <Label htmlFor="manual-prompt">Theme Prompt</Label>
                <Textarea
                  id="manual-prompt"
                  placeholder="Enter your theme system prompt..."
                  className="min-h-[200px] font-mono text-sm"
                  value={manualPrompt}
                  onChange={(e) => setManualPrompt(e.target.value)}
                />
              </div>
            </TabsContent>
            <TabsContent value="ai">
              {themeTab === "ai" && (
                <AIGeneratorTab
                  prompt={manualPrompt}
                  onPromptChange={setManualPrompt}
                />
              )}
            </TabsContent>
          </Tabs>

          <Button
            onClick={handleSave}
            disabled={isSaving || !manualName.trim() || !manualPrompt.trim()}
            className="w-full"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Theme"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
