# Project Purpose

- This repository is a novel-writing workspace with a React manuscript preview.
- Treat `novel/project.md`, `novel/outline.md`, and `novel/bible/` as canonical story context.
- Load and follow the `novel-writing` project skill for fiction planning, drafting, review, or revision.
- Preserve the manuscript's language, viewpoint, tense, and established voice unless the user requests a change.
- Follow the voice fingerprints and prose constraints in `novel/bible/style.md`; treat repeated filler words as review signals rather than a mechanical ban.
- For requests to remove generic or synthetic prose, diagnose cited passages before editing, then make focused replacements instead of rewriting the chapter.
- Use `search_replace` for focused prose edits. Replace an existing chapter only for an explicit rewrite.
- Keep speculative ideas under `novel/notes/`; do not silently promote them into canon.
- The preview reads Markdown from `novel/`. Keep those imports working when reorganizing manuscript files.

# Preview Stack

- Use React, TypeScript, Vite, Tailwind CSS, and Lucide icons.
- Keep routes in `src/App.tsx` and the main manuscript view in `src/pages/Index.tsx`.
- Keep the interface quiet, responsive, and optimized for reading and repeated editorial work.
