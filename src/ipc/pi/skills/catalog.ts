/**
 * Skill catalog serialization for system-prompt disclosure.
 *
 * Follows the agentskills.io disclosure format: a short instruction block plus
 * an `<available_skills>` XML catalog holding only name/description/location
 * per skill (progressive disclosure — full instructions load on demand via
 * `read_skill`). All injected metadata is user-controlled and XML-escaped.
 */

import { escapeXmlAttr } from "../../../../shared/xmlEscape";
import type { SkillInfo } from "./discovery";

export const SKILLS_INSTRUCTIONS_BLOCK = `The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, load the SKILL.md via read_skill
before proceeding. Relative paths in a skill resolve against the skill
directory.`;

/**
 * Cap on skills listed in the injected catalog. Discovery itself stays
 * bounded by its directory and byte budgets; this count cap works with the
 * total-byte cap below to protect the system prompt from ballooning. Skills
 * beyond the caps stay discoverable and loadable via `read_skill`, but the
 * model cannot know their names.
 */
export const MAX_CATALOG_SKILLS = 100;
/** Total UTF-8 budget for the complete injected skills block. */
export const MAX_CATALOG_BYTES = 64 * 1024;

function serializeSkill(skill: SkillInfo): string {
  return (
    `    <skill>\n` +
    `      <name>${escapeXmlAttr(skill.name)}</name>\n` +
    `      <description>${escapeXmlAttr(skill.description)}</description>\n` +
    `      <location>${escapeXmlAttr(skill.location)}</location>\n` +
    `    </skill>`
  );
}

function truncationComment(omitted: number): string {
  return omitted > 0
    ? `\n    <!-- ${omitted} more skills available but omitted from the catalog -->`
    : "";
}

/**
 * Build the disclosure section, or null when no skills are available (callers
 * omit the section entirely instead of showing an empty catalog).
 */
export function buildSkillsCatalogBlock(
  skills: readonly SkillInfo[],
): string | null {
  if (skills.length === 0) {
    return null;
  }

  const prefix = `${SKILLS_INSTRUCTIONS_BLOCK}\n\n<available_skills>\n`;
  const suffix = "\n</available_skills>";
  let catalog = "";
  let shownCount = 0;

  for (const skill of skills.slice(0, MAX_CATALOG_SKILLS)) {
    const entry = serializeSkill(skill);
    const nextCatalog = catalog ? `${catalog}\n${entry}` : entry;
    const nextShownCount = shownCount + 1;
    const candidate =
      prefix +
      nextCatalog +
      truncationComment(skills.length - nextShownCount) +
      suffix;
    if (Buffer.byteLength(candidate, "utf8") > MAX_CATALOG_BYTES) {
      break;
    }
    catalog = nextCatalog;
    shownCount = nextShownCount;
  }

  return (
    prefix + catalog + truncationComment(skills.length - shownCount) + suffix
  );
}
