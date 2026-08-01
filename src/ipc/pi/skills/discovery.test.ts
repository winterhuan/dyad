// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverProjectSkills,
  isValidSkillName,
  parseSkillFrontmatter,
  truncateUtf8,
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

function symlinkDirectory(target: string, linkPath: string): void {
  fs.symlinkSync(
    process.platform === "win32" ? path.resolve(target) : target,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
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

  it("does not treat a decorated line as the closing delimiter", () => {
    const parsed = parseSkillFrontmatter(`---
name: my-skill
description: A skill
--- not a closing marker
Body`);
    expect(parsed).toBeNull();
  });

  it("returns null when the frontmatter block exceeds the byte cap", () => {
    const huge = "description: " + "x".repeat(20 * 1024) + "\n";
    expect(
      parseSkillFrontmatter(`---\nname: my-skill\n${huge}---\nBody`),
    ).toBeNull();
  });

  it("measures the frontmatter cap in UTF-8 bytes", () => {
    const multibyteDescription = "界".repeat(6 * 1024);
    expect(
      parseSkillFrontmatter(
        `---\nname: my-skill\ndescription: ${multibyteDescription}\n---\nBody`,
      ),
    ).toBeNull();
  });
});

describe("truncateUtf8", () => {
  it("does not split a surrogate pair", () => {
    expect(truncateUtf8("😀x", 3)).toBe("");
    expect(truncateUtf8("😀x", 4)).toBe("😀");
    expect(truncateUtf8("😀x", 5)).toBe("😀x");
  });

  it("handles a large ASCII prefix in one pass", () => {
    const result = truncateUtf8("a".repeat(70 * 1024), 64 * 1024);
    expect(result).toHaveLength(64 * 1024);
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
    expect(skills[0]?.directory).toContain(
      path.join(".agents", "skills") + path.sep,
    );
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
    writeSkill(
      "broken",
      "---\nname: broken\ndescription: Has a description\n--- not a closing marker here\nBody",
    );
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["pdf-processing"]);
  });

  it("skips an oversized SKILL.md file", async () => {
    writeSkill("pdf-processing", VALID_SKILL);
    const bigDir = path.join(tempRoot, ".agents", "skills", "big");
    fs.mkdirSync(bigDir, { recursive: true });
    fs.writeFileSync(path.join(bigDir, "SKILL.md"), "x".repeat(600 * 1024));
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills.map((s) => s.name)).toEqual(["pdf-processing"]);
  });

  it("truncates oversized skill descriptions", async () => {
    const longDescription = "d".repeat(5 * 1024);
    writeSkill(
      "chatty",
      `---
name: chatty
description: ${longDescription}
---
Body`,
    );
    const skills = await discoverProjectSkills(tempRoot);
    expect(skills).toHaveLength(1);
    expect(
      Buffer.byteLength(skills[0]!.description, "utf8"),
    ).toBeLessThanOrEqual(2048);
  });

  it("does not follow a skills-root symlink that escapes the app", async () => {
    writeSkill("pdf-processing", VALID_SKILL);
    const externalDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-skill-ext-"),
    );
    try {
      fs.mkdirSync(path.join(externalDir, "skills", "external-skill"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(externalDir, "skills", "external-skill", "SKILL.md"),
        "---\nname: external-skill\ndescription: Outside\n---\nBody",
      );
      fs.rmSync(path.join(tempRoot, ".agents"), {
        recursive: true,
        force: true,
      });
      fs.mkdirSync(path.join(tempRoot, ".agents"));
      symlinkDirectory(
        path.join(externalDir, "skills"),
        path.join(tempRoot, ".agents", "skills"),
      );

      const skills = await discoverProjectSkills(tempRoot);
      expect(skills).toEqual([]);
    } finally {
      await fs.promises.rm(externalDir, { recursive: true, force: true });
    }
  });

  it("does not follow a .agents symlink that escapes the app", async () => {
    const externalDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-skill-ext-"),
    );
    try {
      fs.mkdirSync(path.join(externalDir, "agents", "skills", "ext"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(externalDir, "agents", "skills", "ext", "SKILL.md"),
        "---\nname: ext\ndescription: Outside\n---\nBody",
      );
      fs.rmSync(path.join(tempRoot, ".agents"), {
        recursive: true,
        force: true,
      });
      symlinkDirectory(
        path.join(externalDir, "agents"),
        path.join(tempRoot, ".agents"),
      );

      const skills = await discoverProjectSkills(tempRoot);
      expect(skills).toEqual([]);
    } finally {
      await fs.promises.rm(externalDir, { recursive: true, force: true });
    }
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
      fs.mkdirSync(
        path.join(skillsRoot, `cap-dir-${String(index).padStart(4, "0")}`),
      );
    }
    fs.writeFileSync(
      path.join(skillsRoot, "cap-dir-2000", "SKILL.md"),
      skillContent("beyond-cap"),
    );

    const skills = await discoverProjectSkills(tempRoot);

    expect(skills).toEqual([]);
  }, 30_000);
});
