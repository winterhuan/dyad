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
 * bounded by `MAX_SKILL_DIRECTORIES` (scan cost); this separate cap protects
 * the system prompt from ballooning when an app ships hundreds of skills
 * (~100 tokens per entry). Skills beyond the cap stay discoverable and
 * loadable via `read_skill`, but the model cannot know their names.
 */
export const MAX_CATALOG_SKILLS = 100;

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

  const shown = skills.slice(0, MAX_CATALOG_SKILLS);
  const omitted = skills.length - shown.length;

  const catalog = shown
    .map(
      (skill) =>
        `    <skill>\n` +
        `      <name>${escapeXmlAttr(skill.name)}</name>\n` +
        `      <description>${escapeXmlAttr(skill.description)}</description>\n` +
        `      <location>${escapeXmlAttr(skill.location)}</location>\n` +
        `    </skill>`,
    )
    .join("\n");
  const truncation =
    omitted > 0
      ? `\n    <!-- ${omitted} more skills available but omitted from the catalog -->`
      : "";

  return (
    `${SKILLS_INSTRUCTIONS_BLOCK}\n\n` +
    `<available_skills>\n${catalog}${truncation}\n</available_skills>`
  );
}
