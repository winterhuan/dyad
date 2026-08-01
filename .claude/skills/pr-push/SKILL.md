---
name: dyad:pr-push
description: Publish local work by committing changes, running checks, and pushing the current branch only to the fork remote. Use when work should be committed and pushed without creating or modifying a pull request.
---

# Fork Push

Use this skill to publish the current work to the Git remote named `fork`. It must complete autonomously and push by the end unless authentication or permissions block the operation. It must not create, update, inspect, comment on, label, or otherwise modify a pull request.

## Workflow

1. Run `/remember-learnings` first so any resulting `AGENTS.md` or `rules/` changes are included in the same publish flow.
2. Decide whether to run unit tests locally before publishing. For broad or cross-cutting changes, run `npm test`. For targeted changes, run the narrowest relevant test command, such as `npm test -- path/to/file.test.ts`. For docs, agent-config, or other low-risk changes, it is acceptable to skip local unit tests.
3. Review the complete branch diff and commit range, then choose a descriptive commit message for newly staged work.
4. Run the bundled script from the repository root:

   ```bash
   PR_PUSH_COMMIT_MESSAGE="<descriptive commit message>" \
   bash .agents/skills/pr-push/scripts/pr_push.sh
   ```

5. If the script reports a fixable failure, fix it and rerun the script. Do not manually push to another remote and do not fall back to `origin` or `upstream`.
6. Summarize the script's final output, including the branch, committed files, ignored files, checks, and pushed `fork` ref. Also report the local unit-test decision and any test command that was run.

## Script Behavior

The script handles the mechanical workflow:

- Never pushes local `main` or `master` directly; creates a feature branch first when needed.
- Stages relevant changes while ignoring obvious secrets/artifacts and spurious `package-lock.json` changes without `package.json`.
- Commits changes with a generated message, unless `PR_PUSH_COMMIT_MESSAGE` is set.
- Runs `npm run fmt`, `npm run lint:fix`, and `npm run ts`.
- Does not run unit tests. The agent decides whether to run `npm test` for broad changes or a targeted `npm test -- ...` command for narrow changes.
- Amends automated formatting/lint changes into the commit it created.
- Pushes the current branch only to the Git remote named `fork` with `--force-with-lease` and sets that remote branch as upstream.
- Fails if `fork` is unavailable or the push fails. It never falls back to another remote.
- Performs no GitHub pull-request operations and does not invoke `gh`.

Optional environment override:

- `PR_PUSH_COMMIT_MESSAGE`: commit message for newly staged work.
