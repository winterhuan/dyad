import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/useSettings";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function ProjectSkillsSwitch() {
  const { t } = useTranslation("settings");
  const { settings, updateSettings } = useSettings();
  return (
    <div className="flex items-center space-x-2">
      <Switch
        id="project-skills"
        aria-label={t("ai.projectSkills")}
        checked={settings?.enableProjectSkills !== false}
        onCheckedChange={(checked) => {
          updateSettings({ enableProjectSkills: checked });
        }}
      />
      <Label htmlFor="project-skills">{t("ai.projectSkills")}</Label>
    </div>
  );
}
