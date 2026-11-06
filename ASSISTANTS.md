# Assistant-first fork

The `assistants` branch tracks upstream stable release tags, starting at
`v2.6.1`. Rebase onto release tags instead of following `main`.

## Navigation

An assistant has a project identity, a scratchpad directory and one marked
canonical conversation. Its work sessions can run in other directories.
The sidebar groups work by `metadata.openchamber.startedBy.sessionID`.
See `packages/ui/src/lib/assistants/DOCUMENTATION.md` for the data contract.

Assistant navigation defaults on when the connected server advertises `ui.assistants.v1`; otherwise it defaults off.
Without a session link, the main chat opens the last assistant used on that
runtime, falling back to the first registered assistant. A new-session draft
in an assistant workspace returns to its canonical conversation.
Open `?assistants=off` to return to stock navigation for that server; use
`?assistants=on` to restore it. Overrides are stored per runtime. VS Code keeps its stock sidebar.

Create an assistant with its name, role, uploaded avatar and optional model.
Its scratchpad lives under the server home at `assistants/<slug>`.
Existing `AGENTS.md` files are preserved. A failed creation can leave a
registered workspace; open its assistant row to finish the canonical session.
Do not delete a workspace to retry creation.

## Memory

Assistant memory needs two settings on the server that hosts the assistants,
both off by default:

- **Settings → Chat → Message search** (`messageSearchEnabled`). While it is
  off nothing is indexed and recall and zoom answer that search is disabled.
  Turning it on starts a backfill; recall reports incomplete results until it
  finishes.
- **Memory** (`agentMemoryToolEnabled`). While it is off OpenCode gets no
  `openchamber_memory` tool, the server refuses recall and zoom, and no
  summary tree is built.

Recall and zoom cover the assistant's canonical conversation and the work
sessions it started. The tool description is the assistant's only instruction
for recall; it lives in `MEMORY_TOOL_DESCRIPTION`
(`packages/web/server/lib/agent-tool/runtime.js`). Design and plan:
[issue #2](https://github.com/colthreepv/openchamber/issues/2).

Canonical conversations also build a persistent summary tree in
`assistant-memory.sqlite`, separate from the rebuildable search index.
The managed OpenCode compaction hook inserts a tree view with zoomable
`nodeId` pointers. It preserves OpenCode's verbatim tail and falls back to
native compaction when memory is unavailable or incomplete. Work sessions
remain searchable but do not build trees.

Histories with visible non-text parts and unfinished turns keep native compaction, because
their working state is outside the text index. Only the oldest canonical
session per assistant directory owns a tree; duplicate markers use native
compaction so checkpoint node IDs and zoom keep the same owner.

Building can spend model tokens after message search is enabled. The server
uses at most 1 build at a time, with batches of up to 32 nodes, 1 call per
batch plus at most 1 shortening retry, and a 60-second pause for pending work
or failures. Short exchanges cost no model call. Server-side settings have no
UI: `assistantMemoryTreeEnabled: false` disables building and the hook;
`assistantMemoryModel: "providerID/modelID"` and
`assistantMemoryVariant: "high"` select the compactor. Without an override,
Haiku 5.5 on the session's provider is preferred when listed, followed by
Small Model resolution. No background call selects another connected
provider unless the user explicitly configured it through the model or
Small Model settings. The hot profile/open-loop layer is not implemented.

## Build and preview

```powershell
bun install --frozen-lockfile
bun run build:web
bun run check:changed -- --base v2.6.1
node scripts/run-isolated-tests.mjs packages/ui/src/lib/assistants
bun run --cwd packages/web test server/lib/openchamber-sessions/routes.test.js
```

For a UI preview using an existing server on port 3799:

```powershell
$env:OPENCHAMBER_PORT = '3799'
$env:OPENCHAMBER_DISABLE_PWA_DEV = '1'
bun run --cwd packages/web vite --host localhost --port 5188 --strictPort
```

Open `http://localhost:5188`. Authentication and data requests proxy to that
server; changing data in this preview changes that server's data. The preview
does not install its server route changes into the existing server.

`packages/web/dist` is the web build. The Android app bundles this UI and
requires its own rebuild to show these changes. Server deployment alone does
not update a previously installed APK.

## Assets

Avatars use the existing project image upload endpoint and remain in the
server data directory. No third-party character images ship in this public
fork.

## Maintenance

Keep the assistant projection and components separate from upstream's session
row model and grouping internals. The upstream mount points, headers and
session-create metadata are the intentional integration points.

Canonical creation deduplicates concurrent clicks in one client. Concurrent
creation across different clients is not serialized by the server.
