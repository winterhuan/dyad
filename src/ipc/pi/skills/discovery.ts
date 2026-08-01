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
/** Upper bound on a single SKILL.md read; larger files are skipped. */
const MAX_SKILL_FILE_BYTES = 512 * 1024;
/** Upper bound on the frontmatter block; longer blocks are rejected. */
const MAX_FRONTMATTER_BYTES = 16 * 1024;
/** Aggregate frontmatter bytes read during one discovery pass. */
const MAX_DISCOVERY_READ_BYTES = 8 * 1024 * 1024;
const MAX_FRONTMATTER_SCAN_BYTES = MAX_FRONTMATTER_BYTES + 4;
/** Upper bound on a skill description before truncation (UTF-8 bytes). */
const MAX_SKILL_DESCRIPTION_BYTES = 2048;
const MAX_LOGGED_SKILL_NAME_BYTES = 256;
const SKIPPED_DIR_NAMES = new Set(["node_modules", ".git", "dist", "build"]);
const SKILL_READ_FLAGS =
  fs.constants.O_RDONLY |
  (fs.constants.O_NONBLOCK ?? 0) |
  (fs.constants.O_NOFOLLOW ?? 0);

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

export interface ProjectSkillFileRead {
  content: string;
  bytesRead: number;
  resolvedPath: string;
}

/**
 * Truncate `text` to at most `maxBytes` UTF-8 bytes without splitting a
 * Unicode code point.
 */
export function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";

  let bytes = 0;
  let end = 0;
  while (end < text.length) {
    const codePoint = text.codePointAt(end)!;
    const codeUnits = codePoint > 0xffff ? 2 : 1;
    const codePointBytes =
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    if (bytes + codePointBytes > maxBytes) break;
    bytes += codePointBytes;
    end += codeUnits;
  }
  return text.slice(0, end);
}

function formatSkillNameForLog(name: string): string {
  const truncated = truncateUtf8(name, MAX_LOGGED_SKILL_NAME_BYTES);
  return truncated === name ? name : `${truncated}...`;
}

/**
 * Lenient frontmatter parser: extracts the leading `---`-delimited YAML block
 * as `key: value` lines. Tolerates unquoted values containing colons and
 * folded/block scalar continuations (indented lines append to the current
 * value). Returns null when the content has no frontmatter block, the block
 * never closes, or the block exceeds `MAX_FRONTMATTER_BYTES`.
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
  let frontmatterBytes = Buffer.byteLength(lines[0], "utf8") + 1;

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    frontmatterBytes += Buffer.byteLength(line, "utf8") + 1;
    if (frontmatterBytes > MAX_FRONTMATTER_BYTES) {
      return null;
    }
    // The closing delimiter is exactly `---` on its own line.
    if (trimmed === "---") {
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

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== ".." &&
    !path.isAbsolute(relative)
  );
}

function isSameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function readOpenedFile(
  fileHandle: fs.promises.FileHandle,
  maxBytes: number,
): Promise<{ content: string; bytesRead: number }> {
  const buffer = Buffer.alloc(maxBytes);
  let total = 0;
  while (total < maxBytes) {
    const result = await fileHandle.read(
      buffer,
      total,
      maxBytes - total,
      total,
    );
    if (result.bytesRead === 0) break;
    total += result.bytesRead;
  }
  return {
    content: buffer.subarray(0, total).toString("utf8"),
    bytesRead: total,
  };
}

async function readProjectSkillFileFromResolvedApp(
  realAppPath: string,
  skillMdPath: string,
  maxReadBytes: number,
): Promise<ProjectSkillFileRead> {
  const fileHandle = await fs.promises.open(skillMdPath, SKILL_READ_FLAGS);
  try {
    const openedStat = await fileHandle.stat();
    if (!openedStat.isFile()) {
      throw new Error("SKILL.md is not a regular file");
    }
    if (openedStat.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(
        `file is ${openedStat.size} bytes, exceeding ${MAX_SKILL_FILE_BYTES}`,
      );
    }

    // Validate the path after opening it, then compare identities. If any path
    // component was swapped to a symlink during open, the resolved path either
    // escapes the app or no longer identifies the opened file.
    const resolvedPath = await fs.promises.realpath(skillMdPath);
    if (!isPathInside(realAppPath, resolvedPath)) {
      throw new Error("SKILL.md resolves outside the app directory");
    }
    const resolvedStat = await fs.promises.stat(resolvedPath);
    if (!isSameFile(openedStat, resolvedStat)) {
      throw new Error("SKILL.md changed while it was being opened");
    }

    const readLimit = Math.min(openedStat.size, maxReadBytes);
    const result = await readOpenedFile(fileHandle, readLimit);
    const finalStat = await fileHandle.stat();
    if (!isSameFile(openedStat, finalStat)) {
      throw new Error("SKILL.md changed identity while it was being read");
    }
    if (finalStat.size > MAX_SKILL_FILE_BYTES) {
      throw new Error(
        `file grew to ${finalStat.size} bytes, exceeding ${MAX_SKILL_FILE_BYTES}`,
      );
    }
    return { ...result, resolvedPath };
  } finally {
    await fileHandle.close();
  }
}

/** Securely and boundedly read a discovered SKILL.md at invocation time. */
export async function readProjectSkillFile(
  appPath: string,
  skillMdPath: string,
): Promise<ProjectSkillFileRead> {
  const realAppPath = await fs.promises.realpath(appPath);
  return readProjectSkillFileFromResolvedApp(
    realAppPath,
    skillMdPath,
    MAX_SKILL_FILE_BYTES,
  );
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

  // Project-scoped containment: the resolved skills root must stay inside the
  // app directory. `lstat` alone is not enough — symlinks in intermediate
  // components (e.g. `.agents` itself) are followed by the kernel — so verify
  // the fully resolved path against the resolved app path.
  let realAppPath: string;
  try {
    realAppPath = await fs.promises.realpath(appPath);
  } catch {
    return [];
  }
  let realSkillsRoot: string;
  try {
    realSkillsRoot = await fs.promises.realpath(skillsRoot);
  } catch {
    return [];
  }
  if (!isPathInside(realAppPath, realSkillsRoot)) {
    logger.warn(
      `Skill scan rejected ${skillsRoot}: resolves outside the app directory.`,
    );
    return [];
  }

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
  let discoveryBytesRead = 0;

  scan: while (queue.length > 0) {
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
      const remainingBytes = MAX_DISCOVERY_READ_BYTES - discoveryBytesRead;
      if (remainingBytes <= 0) {
        logger.warn(
          `Skill scan reached its ${MAX_DISCOVERY_READ_BYTES}-byte frontmatter budget; truncating.`,
        );
        break scan;
      }
      const loaded = await loadSkill(
        path.join(dir, entry.name),
        realAppPath,
        Math.min(MAX_FRONTMATTER_SCAN_BYTES, remainingBytes),
      );
      discoveryBytesRead += loaded.bytesRead;
      const skill = loaded.skill;
      if (!skill) continue;
      if (byName.has(skill.name)) {
        logger.warn(
          `Duplicate skill "${formatSkillNameForLog(skill.name)}" shadowed by ${byName.get(skill.name)!.location}; keeping first.`,
        );
        continue;
      }
      byName.set(skill.name, skill);
    }
  }

  return [...byName.values()];
}

interface LoadedSkill {
  skill: SkillInfo | null;
  bytesRead: number;
}

async function loadSkill(
  skillMdPath: string,
  realAppPath: string,
  maxReadBytes: number,
): Promise<LoadedSkill> {
  let read: ProjectSkillFileRead;
  try {
    read = await readProjectSkillFileFromResolvedApp(
      realAppPath,
      skillMdPath,
      maxReadBytes,
    );
  } catch (error) {
    logger.warn(`Failed to read skill ${skillMdPath}: ${error}`);
    return { skill: null, bytesRead: 0 };
  }

  const parsed = parseSkillFrontmatter(read.content);
  const name = parsed?.fields.name;
  const description = parsed?.fields.description;

  if (!name) {
    logger.warn(`Skipping skill ${skillMdPath}: missing frontmatter name.`);
    return { skill: null, bytesRead: read.bytesRead };
  }
  if (!description) {
    logger.warn(
      `Skipping skill ${skillMdPath}: missing frontmatter description.`,
    );
    return { skill: null, bytesRead: read.bytesRead };
  }
  if (!isValidSkillName(name)) {
    logger.warn(
      `Skill "${formatSkillNameForLog(name)}" (${skillMdPath}) violates Agent Skills name rules; loading anyway.`,
    );
  }

  return {
    skill: {
      name,
      description: truncateUtf8(description, MAX_SKILL_DESCRIPTION_BYTES),
      location: skillMdPath,
      directory: path.dirname(skillMdPath),
    },
    bytesRead: read.bytesRead,
  };
}
