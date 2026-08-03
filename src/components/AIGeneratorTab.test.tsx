import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AIGeneratorTab } from "./AIGeneratorTab";

const mocks = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useCustomThemes", () => ({
  useGenerateThemePrompt: () => ({
    mutateAsync: mocks.mutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: {
      selectedModel: { name: "chat-model", provider: "anthropic" },
    },
  }),
}));

vi.mock("@/components/ModelPicker", () => ({
  ModelPicker: ({
    onValueChange,
  }: {
    onValueChange: (model: { name: string; provider: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() => onValueChange({ name: "theme-model", provider: "openai" })}
    >
      choose-theme-model
    </button>
  ),
}));

describe("AIGeneratorTab", () => {
  beforeEach(() => {
    mocks.mutateAsync.mockReset();
    mocks.mutateAsync.mockResolvedValue({ prompt: "generated theme" });
  });

  it("submits the selected generation mode and dedicated model", async () => {
    const onPromptChange = vi.fn();

    render(<AIGeneratorTab prompt="" onPromptChange={onPromptChange} />);

    fireEvent.change(screen.getByLabelText("customTheme.inspiration"), {
      target: { value: "Editorial dashboard" },
    });
    fireEvent.click(screen.getByText("customTheme.highFidelity"));
    fireEvent.click(screen.getByText("choose-theme-model"));
    fireEvent.click(screen.getByText("customTheme.generate"));

    await waitFor(() => {
      expect(mocks.mutateAsync).toHaveBeenCalledWith({
        inspiration: "Editorial dashboard",
        websiteUrl: undefined,
        images: [],
        generationMode: "high-fidelity",
        model: { name: "theme-model", provider: "openai" },
      });
    });
    expect(onPromptChange).toHaveBeenCalledWith("generated theme");
  });
});
