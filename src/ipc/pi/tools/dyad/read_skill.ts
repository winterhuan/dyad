/**
 * read_skill tool — on-demand skill activation.
 *
 * The model activates a skill discovered from the app's `.agents/skills/`
 * directory. Activation re-discovers via `ctx.appPath` (same source the
 * system prompt catalog used, so they always agree) and returns the skill's
 * `SKILL.md` body with the YAML frontmatter stripped, wrapped in identifying
 * XML plus a listing of the skill's supporting files. Resources are listed but
 * never eagerly read; the model loads specific files on demand with its
 * existing read tools.
 */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { ToolDefinition, escapeXmlAttr } from "./types";
import {
  discoverProjectSkills,
  parseSkillFrontmatter,
} from "../../skills/discovery";

const MAX_RESOURCE_DEPTH = 4;
const MAX_RESOURCE_ENTRIES = 200;
const SKIPPED_RESOURCE_DIRS = new Set(["node_modules", ".git"]);

const readSkillSchema = z.object({
  skill: z
    .string()
    .describe(
      "Name of the skill to load (from the <available_skills> catalog in the system prompt)",
    ),
});

export const readSkillTool: ToolDefinition<z.infer<typeof readSkillSchema>> = {
  name: "read_skill",
  description:
    "Load a skill's full instructions. Use this when the system prompt's available skills match the current task.",
  inputSchema: readSkillSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: (ctx) => ctx.enableProjectSkills !== false,

  getConsentPreview: (args) => `Read skill: ${args.skill}`,

  buildXml: (args) => {
    if (!args.skill) return undefined;
    return `<dyad-read-skill name="${escapeXmlAttr(args.skill)}"></dyad-read-skill>`;
  },

  execute: async (args, ctx) => {
    const skills = await discoverProjectSkills(ctx.appPath);
    const skill = skills.find((candidate) => candidate.name === args.skill);
    if (!skill) {
      const available = skills.map((candidate) => candidate.name).join(", ");
      throw new DyadError(
        `Skill "${args.skill}" not found. Available skills: ${available}`,
        DyadErrorKind.NotFound,
      );
    }

    let content: string;
    try {
      content = await fs.promises.readFile(skill.location, "utf8");
    } catch (error) {
      throw new DyadError(
        `Failed to read skill "${args.skill}": ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.NotFound,
      );
    }

    const parsed = parseSkillFrontmatter(content);
    const body = parsed?.body || content.trim();
    const resources = await listSkillResources(skill.directory);

    const parts = [
      `<skill_content name="${escapeXmlAttr(skill.name)}">`,
      body,
      "",
      `Skill directory: ${skill.directory}`,
      "Relative paths in this skill are relative to the skill directory.",
    ];
    if (resources.length > 0) {
      const listing = resources
        .map((resource) => `    <file>${escapeXmlAttr(resource)}</file>`)
        .join("\n");
      const truncation =
        resources.length >= MAX_RESOURCE_ENTRIES
          ? `\n    <!-- listing truncated at ${MAX_RESOURCE_ENTRIES} entries -->`
          : "";
      parts.push(
        "",
        `<skill_resources>\n${listing}${truncation}\n  </skill_resources>`,
      );
    }
    parts.push("</skill_content>");

    return parts.join("\n");
  },
};

/** List a skill directory's files as slash-relative paths, bounded. */
export async function listSkillResources(directory: string): Promise<string[]> {
  const out: string[] = [];
  const queue: Array<{ dir: string; prefix: string; depth: number }> = [
    { dir: directory, prefix: "", depth: 0 },
  ];

  while (queue.length > 0 && out.length < MAX_RESOURCE_ENTRIES) {
    const { dir, prefix, depth } = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (out.length >= MAX_RESOURCE_ENTRIES) {
        break;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIPPED_RESOURCE_DIRS.has(entry.name)) continue;
        if (depth + 1 <= MAX_RESOURCE_DEPTH) {
          queue.push({
            dir: path.join(dir, entry.name),
            prefix: relative,
            depth: depth + 1,
          });
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(relative);
      }
    }
  }

  return out;
}
