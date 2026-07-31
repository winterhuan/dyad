# Project-Level Skills for the Local Agent

## Summary

Add Agent Skills (agentskills.io) support to the local agent: discover user
`SKILL.md` capability packages inside the active app's `.agents/skills/`
directory, disclose a compact name/description catalog in the system prompt,
and let the model load full skill instructions on demand through a new
`read_skill` tool. Skills are project-scoped only (app directory), sit beside
the existing built-in `read_guide` mechanism, and are gated by a new
`enableProjectSkills` setting (default on).

## Skill discovery

- Scan `<appPath>/.agents/skills/` for subdirectories containing a file named
  exactly `SKILL.md`, recursive, skipping `node_modules`, `.git`, and
  `dist`/`build` output directories. Cap recursion depth (4) and directory
  count (2000) to bound scanning cost in large trees.
- Parse the YAML frontmatter between the leading `---` delimiters with a small
  lenient hand-rolled parser (no new `yaml` dependency): `name` and
  `description` are required; tolerate unquoted values containing colons,
  ignore unknown fields, and skip (with a log) skills whose description is
  missing or unparseable.
- Apply lenient name validation per the Agent Skills standard: 1-64 chars,
  lowercase `a-z0-9-`, no leading/trailing/consecutive hyphens. Warn and load
  anyway on violations; do not require the name to match the parent directory.
- On name collisions, keep the first skill found and log a warning.
- Re-discover on every call, keyed by app path: the project-scoped directory
  is small and bounded by the depth/count caps, so a scan costs negligible
  time and avoids mtime-cache invalidation bugs (adding a new skill directory
  does not change the mtime of existing `SKILL.md` files). No content-level
  cache; the discovery module is a pure function of `<appPath>`.
- When no skills are discovered, inject no catalog section. The `read_skill`
  tool stays registered (gated only by the `enableProjectSkills` setting): a
  constant tool set keeps the model's tool-use behavior stable, and a
  spurious call against an empty catalog just fails with `NotFound`.

## Public tool interface

### `read_skill`

```ts
read_skill({
  skill: string; // a discovered skill name; validated at execution time
})
```

- Resolve the skill by name and return its full `SKILL.md` body with the YAML
  frontmatter stripped, wrapped in identifying XML:

  ```
  <skill_content name="pdf-processing">
  [markdown body]

  Skill directory: <absolute skill directory>
  Relative paths in this skill are relative to the skill directory.

  <skill_resources>
    <file>scripts/extract.py</file>
    ...
  </skill_resources>
  </skill_content>
  ```

- Enumerate the skill's supporting files (scripts, references, assets) into
  `<skill_resources>` by listing the skill directory recursively; do not read
  their contents. Cap the listing (e.g. 200 entries) and note truncation.
- Set `modifiesState: false`, `defaultConsent: "always"` (matching
  `read_guide`), `getConsentPreview` returning `Read skill: <name>`, and
  `buildXml` emitting `<dyad-read-skill name="..."></dyad-read-skill>`.
- Accept any string for `skill` and throw `DyadError(NotFound)` for names that
  are not among the currently discovered skills (an enum is not viable: the
  schema is static while the discovery result is disk state; execution-time
  validation also tolerates skills added after prompt assembly).
- The tool is available in agent, ask, and plan modes (same gating as
  `read_guide`).

## System-prompt disclosure

- Append the catalog to the system prompt at the existing assembly site in
  `src/ipc/handlers/chat_stream_handlers.ts` (next to the supabase/neon prompt
  blocks), following the agentskills.io disclosure format:

  ```
  The following skills provide specialized instructions for specific tasks.
  When a task matches a skill's description, load the SKILL.md via read_skill
  before proceeding. Relative paths in a skill resolve against the skill
  directory.

  <available_skills>
    <skill>
      <name>pdf-processing</name>
      <description>Extract text and tables from PDF files.</description>
      <location>/abs/path/.agents/skills/pdf-processing/SKILL.md</location>
    </skill>
  </available_skills>
  ```

- Escape all injected metadata (`escapeXmlAttr`) since skill files are
  user-controlled. Omit the section entirely when the catalog is empty.
- Cap the injected catalog at `MAX_CATALOG_SKILLS` (100) entries with an
  omitted-count comment: discovery's directory cap bounds scan cost, but the
  catalog cap separately protects prompt size (~100 tokens/skill), and a few
  hundred skills would otherwise balloon the system prompt. Skills beyond the
  cap remain loadable via `read_skill` (though the model cannot know their
  names).
- Do NOT inject the catalog in the security-review branch
  (`isSecurityReviewIntent` in `chat_stream_handlers.ts`), which bypasses
  `constructSystemPrompt` and must keep a minimal, project-content-free
  prompt.
- Keep `token_count_handlers.ts` in sync so token estimation includes the
  catalog at the same point (both sites call the same discovery module, so
  they always agree).

## Setting

- Add `enableProjectSkills: z.boolean().optional()` to `BaseUserSettingsFields`
  in `src/lib/schemas.ts`; default to `true` in the settings defaults
  (`enableAppBlueprint` precedent, `src/main/settings.ts`).
- When disabled: no discovery, no catalog injection, `read_skill` absent from
  the tool set.
- Add a toggle to the Settings page following `rules/adding-settings.md`
  (agent section, next to the context-compaction toggle), with i18n keys in
  `src/i18n/locales/{en,es,ko,pt-BR,zh-CN}/settings.json`.

## Implementation changes

### New module: `src/ipc/pi/skills/`

- `discovery.ts` — directory scan, frontmatter parse, validation, and the
  `SkillInfo` type. Pure and unit-testable:
  `discoverProjectSkills(appPath) -> SkillInfo[]`, no cache (scan cost is
  negligible for one bounded project directory).
- `catalog.ts` — catalog-to-XML serializer with escaping, build instructions
  block, `MAX_CATALOG_SKILLS` truncation.
- `read_skill.ts` — `ToolDefinition` implementation (mirrors `read_guide.ts`
  structure); `execute` resolves the skill by calling `discoverProjectSkills(ctx.appPath)`
  itself, so the tool and the injected catalog always agree.

### Wiring

- Register `read_skill` in `TOOL_DEFINITIONS` (`tool_registry.ts`), adjacent
  to `readGuideTool`. The tool discovers via `ctx.appPath` at invocation time.
  Add `enableProjectSkills?: boolean` to `AgentContext` (types.ts) and thread
  `input.settings.enableProjectSkills !== false` into the turn context in
  `execute_chat_turn.ts` so `isEnabled` can gate the tool by the setting.
  No changes to `RunTurnInput`.
- `chat_stream_handlers.ts` appends the catalog (from
  `discoverProjectSkills(appPath)`) to `piSystemPrompt` after
  `constructSystemPrompt` (supabase/neon append site), except in the
  security-review branch.
- `read_skill` execution reads `SKILL.md` from disk at invocation time, so
  edits between prompt assembly and activation are picked up; only
  names/descriptions in the catalog come from the same scan the prompt used.

### Out of scope for v1

- User-level (`~/.agents/skills/`, `~/.claude/skills/`) or ancestor-directory
  discovery — project-scope only.
- Skill commands (`/skill:name`) and user-explicit activation UI.
- Skill content protection during context compaction (skill XML is
  identifiable via `<skill_content>` for a later pass).
- `disable-model-invocation` filtering (no catalog filtering needs it yet).
- Subagent delegation.

## Test plan

- Discovery unit tests: valid/invalid frontmatter (missing description,
  unparseable YAML, colons in values), lenient name validation, recursion and
  skip rules (`node_modules`, depth cap), collision (first wins + warning),
  empty catalog, missing `.agents/skills` directory, and a scan that actually
  exceeds the 2000-directory cap (asserts truncation kicks in, not just that a
  small tree scans).
- Serializer tests: XML escaping of user-controlled names/descriptions, empty
  section omission, `MAX_CATALOG_SKILLS` truncation with the omitted-count
  comment (and its absence at/below the cap).
- `read_skill` tool tests: body returned without frontmatter, resources
  listing, truncation cap, unknown name `NotFound`, skill deleted between
  discovery and invocation `NotFound`, consent defaults.
- Tool-set tests: `read_skill` present in agent/ask/plan modes and absent when
  `enableProjectSkills` is off. Update exact agent/ask/plan tool-set
  expectations and affected request snapshots (new tool changes the declared
  tool list).
- System-prompt coverage through the renderer+IPC harness (fake provider,
  `chat_stream_handlers.pi.test.ts`): catalog block appears in the provider
  context when skills exist, is omitted when `enableProjectSkills` is off, and
  a `read_skill` call executes end-to-end into the persisted transcript.
- Run focused Vitest suites, then `npm run fmt`, `npm run lint`, `npm run ts`.

## Assumptions

- Skills are project-scoped: only `<appPath>/.agents/skills/` is scanned; the
  active app's path is always the root, so `path_safety.ts` needs no changes.
- Skills are user-authored or copied into their app; no trust prompt is shown
  in v1 (the setting toggle is the control).
- Built-in `read_guide` and its framework filtering remain unchanged; skills
  are an additive user-extensible layer.
- Skill instructions can instruct the model to run arbitrary commands; the
  existing per-tool consent gate (`bash` etc.) still applies to every tool the
  model invokes while following a skill. Note that `write_file` is
  `defaultConsent: "always"`, so a malicious skill (e.g. one cloned in via a
  repo's `.agents/skills/`) can direct unapproved file edits without a
  consent prompt — this is the same posture Pi accepts for guide content, but
  a later pass should surface the discovered skill count in the UI. Skill
  names/descriptions are user-controlled text injected into the system prompt:
  XML-escaped and catalog-capped, but accepted as a prompt-injection surface
  in v1 (same posture as Pi).
- The security-review branch keeps the catalog out of the prompt; the
  `read_skill` tool remains available there (low risk: the model would have to
  guess a skill name, and the tool is read-only).
- Frontmatter parsing stays hand-rolled and lenient; no `yaml` dependency is
  added.
