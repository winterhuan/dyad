// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { readSkillTool } from "./read_skill";
import { makeAgentContext } from "./chat_search_spec_utils";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dyad-skill-"));
});

afterEach(async () => {
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
});

function writeSkill(dir: string, content: string): void {
  const skillDir = path.join(tempRoot, ".agents", "skills", dir);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), content);
}

const SKILL = `---
name: pdf-processing
description: Extract text and tables from PDF files.
---

# PDF Processing

Run ./scripts/process.py <input>.
`;

describe("readSkillTool", () => {
  it("is read-only and always-consent by default", () => {
    expect(readSkillTool.modifiesState).toBe(false);
    expect(readSkillTool.defaultConsent).toBe("always");
    expect(readSkillTool.getConsentPreview?.({ skill: "pdf-processing" })).toBe(
      "Read skill: pdf-processing",
    );
  });

  it("is gated by enableProjectSkills", () => {
    const ctx = makeAgentContext({ appPath: tempRoot });
    expect(readSkillTool.isEnabled?.(ctx)).toBe(true);
    expect(
      readSkillTool.isEnabled?.(
        makeAgentContext({ appPath: tempRoot, enableProjectSkills: false }),
      ),
    ).toBe(false);
  });

  it("returns the skill body with frontmatter stripped and resources listed", async () => {
    writeSkill("pdf-processing", SKILL);
    const scriptsDir = path.join(
      tempRoot,
      ".agents",
      "skills",
      "pdf-processing",
      "scripts",
    );
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, "process.py"), "print('hi')");

    const output = await readSkillTool.execute(
      { skill: "pdf-processing" },
      makeAgentContext({ appPath: tempRoot }),
    );

    expect(output).toContain('<skill_content name="pdf-processing">');
    expect(output).toContain("Run ./scripts/process.py <input>.");
    expect(output).not.toContain("frontmatter");
    expect(output).not.toContain("Extract text and tables");
    expect(output).toContain("Skill directory:");
    expect(output).toContain("<file>scripts/process.py</file>");
    expect(output).toContain("</skill_content>");
  });

  it("throws NotFound for an unknown skill", async () => {
    await expect(
      readSkillTool.execute(
        { skill: "missing" },
        makeAgentContext({ appPath: tempRoot }),
      ),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
  });

  it("throws NotFound when the skill is deleted between discovery and invocation", async () => {
    writeSkill("pdf-processing", SKILL);
    const ctx = makeAgentContext({ appPath: tempRoot });
    fs.rmSync(path.join(tempRoot, ".agents", "skills"), {
      recursive: true,
      force: true,
    });
    await expect(
      readSkillTool.execute({ skill: "pdf-processing" }, ctx),
    ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
  });

  it("lists resource truncation cap", async () => {
    writeSkill("pdf-processing", SKILL);
    const resourceDir = path.join(
      tempRoot,
      ".agents",
      "skills",
      "pdf-processing",
      "assets",
    );
    fs.mkdirSync(resourceDir, { recursive: true });
    for (let index = 0; index < 250; index++) {
      fs.writeFileSync(path.join(resourceDir, `file-${index}.txt`), "x");
    }

    const output = await readSkillTool.execute(
      { skill: "pdf-processing" },
      makeAgentContext({ appPath: tempRoot }),
    );
    expect(output).toContain("listing truncated at 200 entries");
  });

  it("does not report truncation when the listing has exactly 200 entries", async () => {
    writeSkill("pdf-processing", SKILL);
    const resourceDir = path.join(
      tempRoot,
      ".agents",
      "skills",
      "pdf-processing",
      "assets",
    );
    fs.mkdirSync(resourceDir, { recursive: true });
    // SKILL.md itself is one entry, so 199 asset files make exactly 200.
    for (let index = 0; index < 199; index++) {
      fs.writeFileSync(path.join(resourceDir, `file-${index}.txt`), "x");
    }

    const output = await readSkillTool.execute(
      { skill: "pdf-processing" },
      makeAgentContext({ appPath: tempRoot }),
    );
    expect(output).not.toContain("listing truncated");
    expect(output).toContain("<file>assets/file-198.txt</file>");
  });

  it("does not resurrect an empty body into the frontmatter", async () => {
    writeSkill(
      "pdf-processing",
      "---\nname: pdf-processing\ndescription: A skill\n---\n",
    );
    const output = await readSkillTool.execute(
      { skill: "pdf-processing" },
      makeAgentContext({ appPath: tempRoot }),
    );
    expect(output).toContain('<skill_content name="pdf-processing">');
    expect(output).not.toContain("name: pdf-processing");
    expect(output).not.toContain("description: A skill");
  });

  it("truncates an oversized skill body", async () => {
    writeSkill(
      "pdf-processing",
      `---
name: pdf-processing
description: A skill
---

${"A".repeat(70 * 1024)}`,
    );
    const output = await readSkillTool.execute(
      { skill: "pdf-processing" },
      makeAgentContext({ appPath: tempRoot }),
    );
    expect(output).toContain("skill body truncated at 65536 bytes");
    const body = output.split("<skill_content")[1] ?? "";
    expect(body.length).toBeLessThan(70 * 1024);
  });

  it("rejects a skills root that resolves outside the app via symlink", async () => {
    const externalDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "dyad-skill-ext-"),
    );
    try {
      fs.mkdirSync(path.join(externalDir, "skills", "pdf-processing"), {
        recursive: true,
      });
      fs.writeFileSync(
        path.join(externalDir, "skills", "pdf-processing", "SKILL.md"),
        `---
name: pdf-processing
description: External skill
---

Body from outside.
`,
      );
      const agentsDir = path.join(tempRoot, ".agents");
      fs.mkdirSync(agentsDir, { recursive: true });
      fs.symlinkSync(
        path.join(externalDir, "skills"),
        path.join(agentsDir, "skills"),
      );

      await expect(
        readSkillTool.execute(
          { skill: "pdf-processing" },
          makeAgentContext({ appPath: tempRoot }),
        ),
      ).rejects.toMatchObject({ kind: DyadErrorKind.NotFound });
    } finally {
      await fs.promises.rm(externalDir, { recursive: true, force: true });
    }
  });

  it("skips node_modules in the resource listing", async () => {
    writeSkill("pdf-processing", SKILL);
    const nm = path.join(
      tempRoot,
      ".agents",
      "skills",
      "pdf-processing",
      "node_modules",
      "dep",
    );
    fs.mkdirSync(nm, { recursive: true });
    fs.writeFileSync(path.join(nm, "index.js"), "x");

    const output = await readSkillTool.execute(
      { skill: "pdf-processing" },
      makeAgentContext({ appPath: tempRoot }),
    );
    expect(output).not.toContain("node_modules");
  });
});
