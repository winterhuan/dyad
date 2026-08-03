import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverProjectSkills } from "@/ipc/pi/skills/discovery";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/dyad-template-test") },
}));

vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(() => ({ selectedTemplateId: "react" })),
}));

import { createFromTemplate } from "./createFromTemplate";

const temporaryDirectories: string[] = [];

async function makeDestination(): Promise<string> {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "dyad-built-in-template-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("createFromTemplate built-in templates", () => {
  it("layers the novel workspace over the React scaffold", async () => {
    const destination = await makeDestination();

    await createFromTemplate({
      fullAppPath: destination,
      templateId: "novel",
    });

    await expect(
      fs.readFile(path.join(destination, "package.json"), "utf8"),
    ).resolves.toContain('"vite"');
    await expect(
      fs.readFile(path.join(destination, "novel", "project.md"), "utf8"),
    ).resolves.toContain("# Untitled Novel");
    const novelWritingSkill = await fs.readFile(
      path.join(destination, ".agents", "skills", "novel-writing", "SKILL.md"),
      "utf8",
    );
    expect(novelWritingSkill).toContain("name: novel-writing");
    expect(novelWritingSkill).toContain(
      "Do not optimize for AI-detector scores",
    );
    await expect(
      fs.readFile(path.join(destination, "novel", "bible", "style.md"), "utf8"),
    ).resolves.toContain("## Voice Fingerprints");
    await expect(
      fs.readFile(path.join(destination, "src", "pages", "Index.tsx"), "utf8"),
    ).resolves.toContain("Manuscript");
    await expect(discoverProjectSkills(destination)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "novel-writing" }),
      ]),
    );
  });

  it("keeps the standard React template free of novel files", async () => {
    const destination = await makeDestination();

    await createFromTemplate({
      fullAppPath: destination,
      templateId: "react",
    });

    await expect(
      fs.access(path.join(destination, "package.json")),
    ).resolves.toBe(undefined);
    await expect(
      fs.access(path.join(destination, "novel", "project.md")),
    ).rejects.toThrow();
  });
});
