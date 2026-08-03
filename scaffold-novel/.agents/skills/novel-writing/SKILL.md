---
name: novel-writing
description: Plan, draft, revise, review, and compile fiction manuscripts stored in the novel/ workspace. Use for novel, novella, chapter, scene, story-bible, character-arc, continuity, pacing, prose, dialogue, or manuscript requests, including recovering prior creative decisions from chat history.
---

# Novel Writing

Treat the files under `novel/` as the manuscript's durable memory. Preserve the
author's intent and language; do not silently replace established facts or voice.

## Load Context

Before planning or writing, read the smallest relevant set:

1. `novel/project.md` for premise, audience, viewpoint, tense, and constraints.
2. `novel/outline.md` for the current act, chapter, and scene purpose.
3. Relevant files under `novel/bible/` for characters, world rules, and time.
4. The previous scene and the scene being edited.

Use `explore_chat_history` only to recover decisions that have not yet reached
the files. Reconcile recovered discussion with the manuscript and ask before
overriding a conflict. Never treat chat history as more authoritative than the
current project files.

## Choose the Operation

- For a broad premise or structural request, propose a compact plan before
  drafting chapters.
- For a draft request, write one scene at a time unless the user asks for a
  different unit.
- For a review request, report findings before changing prose. Cite the file,
  scene ID, and relevant excerpt.
- For a revision request, preserve unaffected prose and established facts.
- For an export request, compile scenes in outline order into `novel/exports/`.

## Draft a Scene

1. Confirm the scene's point of view, setting, timeline position, goal,
   conflict, turn, and outcome from the outline.
2. Identify the facts and unresolved promises that constrain the scene.
3. Draft to `novel/chapters/NNN-slug.md` with this frontmatter:

```yaml
---
scene_id: NNN-NN
pov: Character name
location: Location
timeline: Story-relative time
characters: [Name]
status: draft
---
```

4. Match the project's language, tense, viewpoint distance, voice fingerprints,
   and style guide. Filter observations through what the viewpoint character
   would notice, misunderstand, avoid, or name precisely.
5. End with a meaningful change in knowledge, power, danger, desire, or
   commitment. Prefer an action, discovery, or decision over a summary of what
   the scene meant.

Use `write_file` for a new scene. Use `search_replace` for focused revisions to
an existing scene. Replace a whole existing chapter only when the user clearly
requests a rewrite or the structure has fundamentally changed.

## Control Synthetic Prose

Do not optimize for AI-detector scores or introduce random errors. Preserve
intentional roughness, asymmetry, ambiguity, and idiosyncrasy when they belong
to the viewpoint or voice.

Before delivering a draft, check for these tendencies:

- emotional translation: an image, action, or line of dialogue is immediately
  followed by an explanation of the emotion or theme;
- generic intensifiers and metaphors that could fit any story;
- repeated sentence lengths, balanced clauses, rhetorical triads, and tidy
  paragraph endings;
- dialogue in which every speaker is equally articulate, direct, and aware of
  their own motives;
- frictionless understanding, rapid reconciliation, or insight the scene has
  not earned;
- repeated hedges such as “somehow,” “seemed,” “almost,” “仿佛,” “似乎,”
  “某种,” “悄然,” “微微,” and “不由得.” Treat them as review signals, not a
  mechanical ban.

Prefer concrete character-specific behavior, selective sensory detail,
subtext, interruption, omission, and consequential choices. Delete redundant
explanation before adding more decorative prose. Do not force every paragraph
to state its significance.

## Review Before Revision

Check independently for:

- continuity: chronology, location, injuries, possessions, knowledge, and
  world rules;
- character: motivation, agency, emotional carryover, and distinct voice;
- scene craft: goal, opposition, escalation, turn, outcome, and causal link;
- prose: viewpoint consistency, concrete language, rhythm, repetition, and
  exposition load;
- synthetic prose: emotional explanation, generic imagery, uniform dialogue,
  symmetrical cadence, over-resolved conflict, and aphoristic endings;
- promises: setups introduced, advanced, contradicted, or left unresolved.

Separate definite contradictions from subjective craft suggestions. Do not
change `novel/bible/` to make a contradiction disappear. Ask whether the
manuscript or the bible should change. For prose review, cite each suspect
passage and explain the specific tendency before editing. Apply accepted fixes
with focused `search_replace` operations and leave unaffected prose intact.

## Maintain Durable State

- Update `novel/outline.md` when chapter or scene order changes.
- Update bible files only after a new fact is accepted into canon.
- Keep alternatives and discarded ideas in `novel/notes/`, not in canon files.
- Add a concise entry to `novel/reviews/revision-log.md` after substantial
  accepted revisions; do not log typo-only edits.
- Leave uncertain facts marked `TBD` instead of inventing an answer.
