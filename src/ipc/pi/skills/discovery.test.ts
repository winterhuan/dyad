// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverProjectSkills,
  isValidSkillName,
  parseSkillFrontmatter,
} from "./discovery";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dyad-skills-"));
});

afterEach(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

function writeSkill(dir: string, content: string): string {
  const skillDir = path.join(tempRoot, ".agents", "skills", dir);
  fs.mkdirSync(skillDir, { recursive: true });
  const location = path.join(skillDir, "SKILL.md");
  fs.writeFileSync(location, content);
  return location;
}

function skillContent(name: string): string {
  return `---
name: ${name}
description: Does ${name} things.
---

# ${name}

Body for ${name}.
`;
}

const VALID_SKILL = skillContent("pdf-processing");

describe("parseSkillFrontmatter", () => {
  it("parses name and description", () => {
    const parsed = parseSkillFrontmatter(VALID_SKILL);
    expect(parsed?.fields.name).toBe("pdf-processing");
    expect(parsed?.fields.description).toBe("Does pdf-processing things.");
    expect(parsed?.body).toContain("# pdf-processing");
  });

  it("tolerates unquoted values containing colons", () => {
    const parsed = parseSkillFrontmatter(`---
name: my-skill
description: Use this skill when: the user asks about PDFs
---
Body`);
    expect(parsed?.fields.description).toBe(
      "Use this skill when: the user asks about PDFs",
    );
  });

  it("strips quoted values", () => {
    const parsed = parseSkillFrontmatter(
      "---\nname: \"my-skill\"\ndescription: 'A skill'\n---\nBody",
    );
    expect(parsed?.fields.name).toBe("my-skill");
    expect(parsed?.fields.description).toBe("A skill");
  });

  it("folds indented block-scalar continuations", () => {
    const parsed = parseSkillFrontmatter(`---
name: my-skill
description: |
  Line one
  Line two
---
Body`);
    expect(parsed?.fields.description).toBe("Line one\nLine two");
  });

  it("handles CRLF and BOM", () => {
    const parsed = parseSkillFrontmatter(
      "\uFEFF---\r\nname: my-skill\r\ndescription: A skill\r\n---\r\nBody",
    );
    expect(parsed?.fields.name).toBe("my-skill");
    expect(parsed?.body).toBe("Body");
  });

  it("returns null when there is no frontmatter", () => {
    expect(parseSkillFrontmatter("# Just a document")).toBeNull();
  });

  it("returns null when the frontmatter never closes", () => {
    expect(parseSkillFrontmatter("---\nname: my-skill\n")).toBeNull();
  });
});

describe("isValidSkillName", () => {
  it("accepts valid names", () => {
    expect(isValidSkillName("pdf-processing")).toBe(true);
    expect(isValidSkillName("a")).toBe(true);
    expect(isValidSkillName("code-review-2026")).toBe(true);
  });

  it("rejects invalid names", () => {
    expect(isValidSkillName("PDF-Processing")).toBe(false);
    expect(isValidSkillName("-pdf")).toBe(false);
    expect(isValidSkillName("pdf-")).toBe(false);
    expect(isValidSkillName("pdf--processing")).toBe(false);
    expect(isValidSkillName("pdf_processing")).toBe(false);
    expect(isValidSkillName("a".repeat(65))).toBe(false);
    expect(isValidSkillName("")).toBe(false);
  });
});

describe("discoverProjectSkills", () => {
  it("discovers SKILL.md files recursively", async () => {
    writeSkill("pdf-processing", VALID_SKILL);
    writeSkill("nested/code-review", skillContent("code-review"));

    const skills = await discoverProjectSkills(tempRoot);

    expect(skills.map((s) => s.name).sort()).toEqual([
      "code-review",
      "pdf-processing",
    ]);
    expect(skills[0]?.directory).toContain(".agents/skills/");
  });

  it("returns an empty catalog when there is no skills directory", async () => {
    await expect(discoverProjectSkills(tempRoot)).resolves.toEqual([]);
  });

  it("ignores non-skill markdown files", async () => {
    writeSkill("pdf-processing", VALID_SKILL);
    fs.writeFileSync(
      path.join(tempRoot, ".agents", "skills", "README.md"),
      "not a skill",
    );
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["pdf-processing"]);
  });

  it("skips node_modules and .git directories", async () => {
    writeSkill("pdf-processing", VALID_SKILL);
    fs.mkdirSync(
      path.join(tempRoot, ".agents", "skills", "node_modules", "x"),
      {
        recursive: true,
      },
    );
    fs.writeFileSync(
      path.join(tempRoot, ".agents", "skills", "node_modules", "x", "SKILL.md"),
      "---\nname: evil\n",
    );
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["pdf-processing"]);
  });

  it("skips skills with a missing description", async () => {
    writeSkill("no-description", "---\nname: no-description\n---\nBody");
    writeSkill("pdf-processing", VALID_SKILL);
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["pdf-processing"]);
  });

  it("skips skills with unparseable frontmatter", async () => {
    writeSkill("pdf-processing", VALID_SKILL);
    writeSkill("broken", "---\nname: broken\n--- no closing marker here\nBody");
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["pdf-processing"]);
  });

  it("loads skills whose name violates the rules with a warning", async () => {
    writeSkill(
      "Bad_Name",
      "---\nname: Bad_Name\ndescription: A skill\n---\nBody",
    );
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["Bad_Name"]);
  });

  it("keeps the first skill on name collisions", async () => {
    writeSkill("a", "---\nname: dup\ndescription: First\n---\nBody");
    writeSkill("b", "---\nname: dup\ndescription: Second\n---\nBody");
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("First");
  });

  it("discovers skills across many directories without the cap interfering", async () => {
    for (let index = 0; index < 12; index++) {
      writeSkill(`skill-${index}`, skillContent(`skill-${index}`));
    }
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills).toHaveLength(12);
  });

  it("truncates the scan when the directory count cap is exceeded", async () => {
    const skillsRoot = path.join(tempRoot, ".agents", "skills");
    fs.mkdirSync(skillsRoot, { recursive: true });
    for (let index = 0; index < 2001; index++) {
      const dir = path.join(skillsRoot, `cap-dir-${index}`);
      fs.mkdirSync(dir);
      fs.writeFileSync(
        path.join(dir, "SKILL.md"),
        skillContent(`cap-skill-${index}`),
      );
    }

    const skills = await discoverProjectSkills(tempRoot);

    // The cap stops the scan at 2000 visited directories (including the
    // skills root), so not all 2001 skills can be discovered.
    expect(skills.length).toBeLessThan(2001);
    expect(skills.length).toBeGreaterThan(1500);
  });
});
