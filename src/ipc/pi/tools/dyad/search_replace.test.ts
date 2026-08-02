// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ ipcHandlers: new Map() }));

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

vi.mock("@/supabase_admin/supabase_management_client", () => ({
  deploySupabaseFunction: vi.fn(),
}));

import type { AgentContext } from "./types";
import { searchReplaceTool } from "./search_replace";

describe("searchReplaceTool", () => {
  let appPath: string;

  beforeEach(() => {
    appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-search-replace-"));
  });

  afterEach(() => {
    fs.rmSync(appPath, { recursive: true, force: true });
  });

  function context(): AgentContext {
    return {
      appPath,
      supabaseProjectId: null,
      supabaseOrganizationSlug: null,
      isSharedModulesChanged: false,
      sharedServerModulePaths: [],
      pendingFunctionDeploys: [],
    } as unknown as AgentContext;
  }

  it("declares a state-modifying search_replace tool", () => {
    expect(searchReplaceTool.name).toBe("search_replace");
    expect(searchReplaceTool.modifiesState).toBe(true);
    expect(() =>
      searchReplaceTool.inputSchema.parse({
        file_path: "chapter.md",
        old_string: "old",
        new_string: "new",
      }),
    ).not.toThrow();
  });

  it("applies a targeted edit to an existing file", async () => {
    const filePath = path.join(appPath, "chapter.md");
    fs.writeFileSync(filePath, "Opening\nOld paragraph\nEnding");

    await expect(
      searchReplaceTool.execute(
        {
          file_path: "chapter.md",
          old_string: "Old paragraph",
          new_string: "Revised paragraph",
        },
        context(),
      ),
    ).resolves.toBe("Successfully applied edits to chapter.md");
    expect(fs.readFileSync(filePath, "utf8")).toBe(
      "Opening\nRevised paragraph\nEnding",
    );
  });

  it("does not write when the search block is ambiguous", async () => {
    const filePath = path.join(appPath, "chapter.md");
    const original = "Repeated\nMiddle\nRepeated";
    fs.writeFileSync(filePath, original);

    await expect(
      searchReplaceTool.execute(
        {
          file_path: "chapter.md",
          old_string: "Repeated",
          new_string: "Changed",
        },
        context(),
      ),
    ).rejects.toThrow("ambiguous");
    expect(fs.readFileSync(filePath, "utf8")).toBe(original);
  });

  it("rejects identical search and replacement text", async () => {
    await expect(
      searchReplaceTool.execute(
        {
          file_path: "chapter.md",
          old_string: "same",
          new_string: "same",
        },
        context(),
      ),
    ).rejects.toThrow("must be different");
  });

  it("rejects a missing target file", async () => {
    await expect(
      searchReplaceTool.execute(
        {
          file_path: "missing.md",
          old_string: "old",
          new_string: "new",
        },
        context(),
      ),
    ).rejects.toThrow("File does not exist");
  });

  it("rejects mutation through a symlink outside the app", async () => {
    const externalPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-search-replace-outside-"),
    );
    fs.writeFileSync(path.join(externalPath, "chapter.md"), "old");
    fs.symlinkSync(externalPath, path.join(appPath, "outside"));

    try {
      await expect(
        searchReplaceTool.execute(
          {
            file_path: "outside/chapter.md",
            old_string: "old",
            new_string: "new",
          },
          context(),
        ),
      ).rejects.toThrow("outside the app");
      expect(
        fs.readFileSync(path.join(externalPath, "chapter.md"), "utf8"),
      ).toBe("old");
    } finally {
      fs.rmSync(externalPath, { recursive: true, force: true });
    }
  });

  it("escapes XML and marker-like lines in the renderer payload", () => {
    const xml = searchReplaceTool.buildXml?.(
      {
        file_path: "a&b.md",
        old_string: "<<<<<<< HEAD\nA < B",
        new_string: "=======\nA > B",
      },
      true,
    );

    expect(xml).toContain('path="a&amp;b.md"');
    expect(xml).toContain("\\&lt;&lt;&lt;&lt;&lt;&lt;&lt; HEAD");
    expect(xml).toContain("A &lt; B");
    expect(xml).toContain("\\=======");
    expect(xml).toContain("A &gt; B");
  });
});
