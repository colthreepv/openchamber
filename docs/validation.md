# Assistant prompt validation

## Automated checks

- `bun run check:changed -- --base v2.6.1` passes type checks, lint, dead-code
  checks and the anti-slop ratchet. Lint retains the existing inline-picker
  exhaustive-deps warning; Knip reports 3 existing configuration hints.
- `node scripts/run-isolated-tests.mjs packages/ui/src/lib/assistants` passes
  all 4 files, including creation without a directory instruction upload.
- Web Vitest passes 184 tests across assistant prompt, managed config,
  core routes, session-title plugin and session routes.
- `bun run build:web` passes on Windows with Bun. Vite reports oversized
  chunks. The production client build takes 86 seconds in the measured run;
  the service worker takes 14 milliseconds.
- `node --test packages/electron/scripts/packaged-app-contents.test.cjs`
  passes all 9 tests, including the actual Electron Builder dependency filter
  retaining the prompt and the archive completeness check requiring it.

## OpenCode runtime coverage

The materialized plugin loads in an isolated OpenCode v2.2.5 SDK host using
a temporary home/config tree and temporary SQLite database. A test model and
LLM client replace provider resolution and network dispatch. Captured requests
verify the exact substituted first system block, absence for same-directory
children and ordinary sessions, and byte-identical text across 2 canonical
turns. No live OpenChamber sessions or external model calls are used.
The subsequent import-free boundary parser and Claude Agent option handling
are covered by focused module tests; the isolated SDK run predates those edits.

The isolated run does not exercise HTTP sender adapters, provider-specific
cache accounting, actual model adherence, or a packaged desktop launch. Unit tests
cover duplicate-marker paging and tie-breaking, starter metadata exclusion,
feature-off registration and advertising, invalidation during a pending read,
failed-read retry and metadata changes. The Claude Agent provider option
receives the identity prefix in a focused hook test; its CLI is not exercised.
