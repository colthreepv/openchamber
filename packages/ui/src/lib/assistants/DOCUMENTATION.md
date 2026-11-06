# Assistant navigation

## Ownership

This module projects the project registry and global sessions into assistants.
Each assistant owns a scratchpad directory and one canonical session. Its face,
display name and default model use the existing project identity fields. The
canonical session stores the role in `metadata.openchamber.assistant`.

Web, Electron and hosted mobile use this navigation. Capacitor uses the same
components after rebuilding its bundled UI. VS Code retains its workspace-scoped
stock sidebar; the assistant navigation is not mounted there.

## Invariants

- Work belongs to its recorded starter across directory boundaries. Follow
  `metadata.openchamber.startedBy.sessionID` to the canonical assistant.
- Subagent sessions remain owned by their work session and are not separate
  assistant work rows. Archived sessions are excluded.
- A missing canonical session leaves its registered assistant workspace visible.
- Selecting a work session routes to that session's directory, never the
  assistant's scratchpad.
- Busy state comes from the global live status index. A load failure retains
  cached rows and exposes retry; an empty list alone does not prove successful
  loading.
- Navigation defaults to the connected server's `ui.assistants.v1` capability. While loading or on failure, retain the last successful in-memory value for that runtime, or use stock navigation if none exists.
- `?assistants=on|off` stores an override for the current runtime only. The old global key is ignored. Transient runtimes do not persist overrides.

## Decisions

### Why project identity and session metadata

These records already persist across clients. An additional assistant database
or generated settings key would duplicate their authority and enlarge the fork.

### Why starter metadata instead of OpenCode parentage

Independent work sessions can run in any directory. Keeping their display
ownership in metadata avoids inheriting subagent depth and archive cascades.

### Why the oldest canonical marker wins

If duplicate markers exist, recent activity must not switch the assistant's
conversation. Creation time and a stable ID tie-breaker choose its identity.
