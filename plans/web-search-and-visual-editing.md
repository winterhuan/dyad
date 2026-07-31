# Web Search and Visual Editing Implementation Plan

Recovered from the Codex session archive on 2026-07-31. The original plan was
recorded in:

`~/.codex/sessions/2026/07/29/rollout-2026-07-29T06-12-42-019faac9-886e-75f1-8bca-1fcc6860f681.jsonl:6730`

The initial implementation landed in commit `c067ed42`.

## Scope

This phase implements only:

1. Pi-based public web search and webpage fetching.
2. Visual editing for React/Vite applications.

CubeSandbox, cloud preview, remote runtime, sharing links, and related settings
remain deferred. This phase does not restore the former cloud runtime or add a
Cube SDK, database tables, IPC endpoints, or runtime-provider abstractions.

## Web Access

- Add `web_search` backed by Exa and Brave, with `auto | exa | brave` provider
  selection.
- Add `fetch_content` for public HTTP/HTTPS pages.
- Make both read-only tools available in Ask, Plan, and Build modes when Web
  Access is enabled. Expose `web_search` only when the selected provider has a
  configured key.
- Limit search to four queries, ten results per query, and a bounded total
  result size.
- Limit fetch response size, timeout, and redirects. Revalidate every redirect
  and reject loopback, link-local, private, and reserved addresses.
- Keep Jina Reader fallback disabled so URLs are not sent to an unconfigured
  third party.
- Provide settings for enablement, provider selection, Exa and Brave keys, and
  provider connection tests.
- Write keys through dedicated main-process IPC. The renderer may read only
  `hasExaKey` and `hasBraveKey`, never raw Web Access credentials.
- Keep API keys, authorization headers, upstream response bodies, and internal
  errors out of transcripts, logs, and telemetry.

## Visual Editing

- Restore the component tagger, selection, toolbar, changes dialog, annotator,
  iframe messaging, component analysis, and AST source updates outside
  `src/pro` and without Pro or experiment gates.
- Support React/Vite applications using
  `@dyad-sh/react-vite-component-tagger`. Do not expose the entry point or
  rewrite build configuration for unsupported project types.
- Support Tailwind style changes, static text, static image URLs, image upload,
  pending changes, save, and discard.
- Keep dynamic class names, expression text, dynamic images, and unreliable
  nested JSX text read-only.
- Validate iframe messages against both the current iframe window and the
  current app origin.
- Resolve the app path again in main, normalize relative paths, reject path
  escapes and missing files, and serialize mutations by `appId`.
- Parse and print JSX/TSX using Babel and Recast. Group changes by file so each
  source file is read, transformed, and written once per batch.
- Permit JPEG, PNG, GIF, and WebP uploads up to 7.5 MB. Store the staging copy
  in `.dyad/media` and the served copy in `public/images`.
- Commit all successfully modified files once. On a batch failure, restore
  source files, staged paths, and written images.
- Return `modifiedFiles`, `commitHash`, `appliedCount`, and component-level
  `skipped` reasons from `visualEditing.applyChanges`.
- Rely on the existing host/docker file watcher to refresh previews. Do not add
  cloud synchronization hooks.

## Accepted Deviations

These deviations are intentional and supersede the corresponding wording in
the recovered plan:

- Web tools remain native Dyad Pi tools under `src/ipc/pi/tools/dyad/`. Do not
  add `@earendil-works/pi-coding-agent`, `createAgentSession()`, a general Pi
  plugin loader, plugin auto-discovery, or `pi install` support.
- The reviewed behavior of `pi-agent-web-access` is implemented locally rather
  than vendoring or loading the package as a runtime extension.
- Component locations use `relativePath:line:column`, preserving the more
  precise protocol already implemented on the `winter` branch.
- Pending visual changes remain in app-keyed Jotai state. The preview state
  machine owns iframe and editing lifecycle transitions, but all visual-editing
  state is not moved into the machine.
- The visual-editing E2E coverage may combine style and text into one workflow,
  while image replacement remains a separate workflow.

## Verification

- Unit-test provider selection, credential isolation, connection testing,
  result limits, cancellation, SSRF and redirect protection, and error
  redaction.
- Unit-test iframe source/origin validation and visual-editing state isolation.
- Unit-test AST style, text, image, multi-file, dynamic JSX, skipped-component,
  and rollback behavior.
- Build the application before running the focused visual-editing Playwright
  tests.
- Before publishing, run `npm run fmt`, `npm run lint`, `npm run ts`, and
  `npm run build`.

## Assumptions

- Web Access is disabled by default and requires explicit user configuration.
- Only the audited built-in Web Access tools are supported; arbitrary user Pi
  plugins are out of scope.
- Visual editing is free and supported only for static React/Vite JSX/TSX in
  this phase.
- `RuntimeMode2` remains `host | docker`; legacy `cloud` values continue to
  migrate to `host`.
- CubeSandbox dependencies, settings, state, tests, and UI remain out of scope.
