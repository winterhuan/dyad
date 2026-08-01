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
  readProjectSkillFile,
  truncateUtf8,
} from "../../skills/discovery";

const MAX_RESOURCE_DEPTH = 4;
const MAX_RESOURCE_ENTRIES = 200;
/** Upper bound on the skill body returned to the model (UTF-8 bytes). */
const MAX_SKILL_BODY_BYTES = 64 * 1024;
const MAX_SKILL_NAME_DISPLAY_BYTES = 256;
const MAX_AVAILABLE_SKILLS_IN_ERROR = 20;
const SKIPPED_RESOURCE_DIRS = new Set(["node_modules", ".git"]);

function displaySkillName(name: string): string {
  return truncateUtf8(name, MAX_SKILL_NAME_DISPLAY_BYTES);
}

function formatAvailableSkills(skills: readonly { name: string }[]): string {
  const shown = skills
    .slice(0, MAX_AVAILABLE_SKILLS_IN_ERROR)
    .map((skill) => displaySkillName(skill.name));
  const omitted = skills.length - shown.length;
  return shown.join(", ") + (omitted > 0 ? `, ... (${omitted} more)` : "");
}

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

  getConsentPreview: (args) => `Read skill: ${displaySkillName(args.skill)}`,

  buildXml: (args) => {
    if (!args.skill) return undefined;
    return `<dyad-read-skill name="${escapeXmlAttr(displaySkillName(args.skill))}"></dyad-read-skill>`;
  },

  execute: async (args, ctx) => {
    const skills = await discoverProjectSkills(ctx.appPath);
    const skill = skills.find((candidate) => candidate.name === args.skill);
    if (!skill) {
      const available = formatAvailableSkills(skills);
      throw new DyadError(
        `Skill "${displaySkillName(args.skill)}" not found. Available skills: ${available}`,
        DyadErrorKind.NotFound,
      );
    }

    let content: string;
    let resolvedPath: string;
    try {
      ({ content, resolvedPath } = await readProjectSkillFile(
        ctx.appPath,
        skill.location,
      ));
    } catch (error) {
      throw new DyadError(
        `Failed to read skill "${displaySkillName(args.skill)}": ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.NotFound,
      );
    }

    const parsed = parseSkillFrontmatter(content);
    // Fall back to the full file only when there is no frontmatter at all;
    // an empty body must not resurrect the frontmatter.
    let body = parsed ? parsed.body : content.trim();
    let bodyTruncated = false;
    if (Buffer.byteLength(body, "utf8") > MAX_SKILL_BODY_BYTES) {
      body = truncateUtf8(body, MAX_SKILL_BODY_BYTES);
      bodyTruncated = true;
    }
    const skillDirectory = path.dirname(resolvedPath);
    const { entries: resources, truncated } =
      await listSkillResources(skillDirectory);

    const parts = [
      `<skill_content name="${escapeXmlAttr(displaySkillName(skill.name))}">`,
      body,
      ...(bodyTruncated
        ? ["", `<!-- skill body truncated at ${MAX_SKILL_BODY_BYTES} bytes -->`]
        : []),
      "",
      `Skill directory: ${skillDirectory}`,
      "Relative paths in this skill are relative to the skill directory.",
    ];
    if (resources.length > 0) {
      const listing = resources
        .map((resource) => `    <file>${escapeXmlAttr(resource)}</file>`)
        .join("\n");
      const truncation = truncated
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

export interface SkillResourceListing {
  entries: string[];
  truncated: boolean;
}

/**
 * List a skill directory's files as slash-relative paths, bounded. Scans one
 * entry past `MAX_RESOURCE_ENTRIES` so `truncated` distinguishes "exactly
 * 200 entries" from "more than 200 entries".
 */
export async function listSkillResources(
  directory: string,
): Promise<SkillResourceListing> {
  let rootDirectory: string;
  try {
    rootDirectory = await fs.promises.realpath(directory);
  } catch {
    return { entries: [], truncated: false };
  }
  const out: string[] = [];
  const queue: Array<{ dir: string; prefix: string; depth: number }> = [
    { dir: rootDirectory, prefix: "", depth: 0 },
  ];
  const scanLimit = MAX_RESOURCE_ENTRIES + 1;

  while (queue.length > 0 && out.length < scanLimit) {
    const { dir, prefix, depth } = queue.shift()!;
    let resolvedDir: string;
    try {
      resolvedDir = await fs.promises.realpath(dir);
    } catch {
      continue;
    }
    const relativeToRoot = path.relative(rootDirectory, resolvedDir);
    if (
      relativeToRoot === ".." ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    ) {
      continue;
    }
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(resolvedDir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (out.length >= scanLimit) {
        break;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIPPED_RESOURCE_DIRS.has(entry.name)) continue;
        if (depth + 1 <= MAX_RESOURCE_DEPTH) {
          queue.push({
            dir: path.join(resolvedDir, entry.name),
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

  const truncated = out.length > MAX_RESOURCE_ENTRIES;
  return {
    entries: truncated ? out.slice(0, MAX_RESOURCE_ENTRIES) : out,
    truncated,
  };
}
