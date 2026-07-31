/**
 * Project-level skill discovery.
 *
 * Discovers Agent Skills (agentskills.io) capability packages inside the
 * active app's `.agents/skills/` directory: scans for subdirectories
 * containing a `SKILL.md` file, parses the YAML frontmatter leniently (no
 * yaml dependency), and returns a catalog of name/description/location.
 *
 * The catalog is a pure function of `<appPath>`: the project-scoped directory
 * is small and bounded by the depth/count caps, so every call re-scans instead
 * of caching, avoiding mtime-cache invalidation bugs (adding a new skill
 * directory does not change the mtime of existing `SKILL.md` files).
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

const logger = log.scope("pi-skills");

export interface SkillInfo {
  /** Frontmatter `name`. */
  name: string;
  /** Frontmatter `description`. */
  description: string;
  /** Absolute path to the `SKILL.md` file. */
  location: string;
  /** Absolute skill directory (parent of `location`). */
  directory: string;
}

const MAX_SKILL_DEPTH = 4;
const MAX_SKILL_DIRECTORIES = 2000;
const SKIPPED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build"]);

const SKILL_MD_NAME = "SKILL.md";

/** Lenient name validation per the Agent Skills standard. */
export function isValidSkillName(name: string): boolean {
  if (name.length < 1 || name.length > 64) return false;
  if (!/^[a-z0-9-]+$/.test(name)) return false;
  if (name.startsWith("-") || name.endsWith("-")) return false;
  if (name.includes("--")) return false;
  return true;
}

export interface ParsedSkillFrontmatter {
  fields: Record<string, string>;
  /** Markdown body after the closing `---` delimiter, trimmed. */
  body: string;
}

/**
 * Lenient frontmatter parser: extracts the leading `---`-delimited YAML block
 * as `key: value` lines. Tolerates unquoted values containing colons and
 * folded/block scalar continuations (indented lines append to the current
 * value). Returns null when the content has no frontmatter block.
 */
export function parseSkillFrontmatter(
  content: string,
): ParsedSkillFrontmatter | null {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  if (!lines[0]?.trim().startsWith("---")) {
    return null;
  }

  const fields: Record<string, string> = {};
  let currentKey: string | undefined;
  const values: string[] = [];
  let closingIndex = -1;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed === "---" || trimmed.startsWith("--- ")) {
      closingIndex = index;
      break;
    }
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (match) {
      if (currentKey) {
        fields[currentKey] = values.join("\n").trim();
      }
      currentKey = match[1];
      values.length = 0;
      const rawValue = match[2].trim();
      // Block-scalar indicators (`|`, `>`, with optional chomping modifiers)
      // only open a folded continuation; the indicator itself is not content.
      if (rawValue && !/^[|>][+-]?$/.test(rawValue)) {
        values.push(stripQuotes(rawValue));
      }
    } else if (currentKey && /^\s+\S/.test(line)) {
      // Folded/block scalar continuation.
      values.push(stripQuotes(trimmed));
    }
  }

  if (currentKey) {
    fields[currentKey] = values.join("\n").trim();
  }

  if (closingIndex < 0) {
    return null;
  }

  const body = lines
    .slice(closingIndex + 1)
    .join("\n")
    .trim();
  return { fields, body };
}

function stripQuotes(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/** Discover skills under `<appPath>/.agents/skills/`. */
export async function discoverProjectSkills(
  appPath: string,
): Promise<SkillInfo[]> {
  const skillsRoot = path.join(appPath, ".agents", "skills");

  let rootStat: fs.Stats;
  try {
    rootStat = await fs.promises.stat(skillsRoot);
  } catch {
    return [];
  }
  if (!rootStat.isDirectory()) {
    return [];
  }

  const byName = new Map<string, SkillInfo>();
  const visited = new Set<string>();
  const queue: Array<{ dir: string; depth: number }> = [
    { dir: skillsRoot, depth: 0 },
  ];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (visited.size >= MAX_SKILL_DIRECTORIES) {
      logger.warn(
        `Skill scan exceeded ${MAX_SKILL_DIRECTORIES} directories; truncating.`,
      );
      break;
    }
    if (visited.has(dir)) {
      continue;
    }
    visited.add(dir);

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIR_NAMES.has(entry.name)) continue;
        if (depth + 1 <= MAX_SKILL_DEPTH) {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
        continue;
      }
      if (entry.name !== SKILL_MD_NAME || !entry.isFile()) {
        continue;
      }
      const skill = await loadSkill(path.join(dir, entry.name));
      if (!skill) continue;
      if (byName.has(skill.name)) {
        logger.warn(
          `Duplicate skill "${skill.name}" shadowed by ${byName.get(skill.name)!.location}; keeping first.`,
        );
        continue;
      }
      byName.set(skill.name, skill);
    }
  }

  return [...byName.values()];
}

async function loadSkill(skillMdPath: string): Promise<SkillInfo | null> {
  let content: string;
  try {
    content = await fs.promises.readFile(skillMdPath, "utf8");
  } catch (error) {
    logger.warn(`Failed to read skill ${skillMdPath}: ${error}`);
    return null;
  }

  const parsed = parseSkillFrontmatter(content);
  const name = parsed?.fields.name;
  const description = parsed?.fields.description;

  if (!name) {
    logger.warn(`Skipping skill ${skillMdPath}: missing frontmatter name.`);
    return null;
  }
  if (!description) {
    logger.warn(
      `Skipping skill ${skillMdPath}: missing frontmatter description.`,
    );
    return null;
  }
  if (!isValidSkillName(name)) {
    logger.warn(
      `Skill "${name}" (${skillMdPath}) violates Agent Skills name rules; loading anyway.`,
    );
  }

  return {
    name,
    description,
    location: skillMdPath,
    directory: path.dirname(skillMdPath),
  };
}
