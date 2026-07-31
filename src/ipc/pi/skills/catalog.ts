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
 * Build the disclosure section, or null when no skills are available (callers
 * omit the section entirely instead of showing an empty catalog).
 */
export function buildSkillsCatalogBlock(
  skills: readonly SkillInfo[],
): string | null {
  if (skills.length === 0) {
    return null;
  }

  const catalog = skills
    .map(
      (skill) =>
        `    <skill>\n` +
        `      <name>${escapeXmlAttr(skill.name)}</name>\n` +
        `      <description>${escapeXmlAttr(skill.description)}</description>\n` +
        `      <location>${escapeXmlAttr(skill.location)}</location>\n` +
        `    </skill>`,
    )
    .join("\n");

  return (
    `${SKILLS_INSTRUCTIONS_BLOCK}\n\n` +
    `<available_skills>\n${catalog}\n</available_skills>`
  );
}
