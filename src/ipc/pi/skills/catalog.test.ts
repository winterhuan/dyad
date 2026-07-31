// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildSkillsCatalogBlock } from "./catalog";
import type { SkillInfo } from "./discovery";

function skill(overrides: Partial<SkillInfo>): SkillInfo {
  return {
    name: "pdf-processing",
    description: "Extract text and tables from PDF files.",
    location: "/tmp/app/.agents/skills/pdf-processing/SKILL.md",
    directory: "/tmp/app/.agents/skills/pdf-processing",
    ...overrides,
  };
}

describe("buildSkillsCatalogBlock", () => {
  it("returns null for an empty catalog", () => {
    expect(buildSkillsCatalogBlock([])).toBeNull();
  });

  it("lists name, description, and location for each skill", () => {
    const block = buildSkillsCatalogBlock([skill({})]);
    expect(block).toContain("<available_skills>");
    expect(block).toContain("<name>pdf-processing</name>");
    expect(block).toContain(
      "<description>Extract text and tables from PDF files.</description>",
    );
    expect(block).toContain(
      "<location>/tmp/app/.agents/skills/pdf-processing/SKILL.md</location>",
    );
  });

  it("includes the instructions block", () => {
    const block = buildSkillsCatalogBlock([skill({})]);
    expect(block).toContain("load the SKILL.md via read_skill");
  });

  it("escapes user-controlled metadata", () => {
    const block = buildSkillsCatalogBlock([
      skill({
        name: 'x"y',
        description: "a <b> & 'c'",
      }),
    ]);
    expect(block).toContain("<name>x&quot;y</name>");
    expect(block).toContain("<description>a &lt;b&gt; &amp; 'c'</description>");
  });

  it("sorts skills in catalog order as provided", () => {
    const block = buildSkillsCatalogBlock([
      skill({ name: "zebra" }),
      skill({ name: "alpha" }),
    ])!;
    expect(block.indexOf("zebra")).toBeLessThan(block.indexOf("alpha"));
  });

  it("caps the catalog at MAX_CATALOG_SKILLS and notes omitted skills", () => {
    const skills = Array.from({ length: 150 }, (_, index) =>
      skill({ name: `skill-${index}` }),
    );
    const block = buildSkillsCatalogBlock(skills)!;

    expect(block).toContain("<name>skill-0</name>");
    expect(block).toContain("<name>skill-99</name>");
    expect(block).not.toContain("<name>skill-100</name>");
    expect(block).toContain(
      "<!-- 50 more skills available but omitted from the catalog -->",
    );
  });

  it("omits the truncation comment when at or under the cap", () => {
    const block = buildSkillsCatalogBlock(
      Array.from({ length: 100 }, (_, index) =>
        skill({ name: `skill-${index}` }),
      ),
    )!;
    expect(block).not.toContain("more skills available but omitted");
  });
});
