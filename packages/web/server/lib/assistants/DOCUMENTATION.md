# Assistant session prompt

## Ownership

This module supplies `assistant-prompt.md` to the managed OpenCode context hook.
The UI assistant projection owns navigation and creation. OpenCode owns session
records; the control service owns work-session starter metadata.

## Invariants

- Only the oldest active root canonical marker in a directory receives the
  block. Creation time and then session ID break ties, matching navigation.
  A `startedBy.sessionID` always excludes a work session, even with a copied
  marker. Legacy top-level assistant markers remain readable.
- Name and role come from the canonical session's metadata. Personal context
  comes from conversation, memory and the user's instructions.
- Every primary model request gets the same system prefix until identity
  metadata changes. UI sends, schedules, result delivery and tool sends all
  reach this hook. Auxiliary title and compaction requests keep their own prompts.
  Claude Agent snapshots instructions in an earlier built-in hook, so its
  `claudeCodeInstructions` provider option receives the same prefix too.
- Session reads are cached per plugin instance; identity-changing events clear
  them. Failed reads propagate and can be retried. A failed event subscription
  disables caching. Each cache holds at most 256 entries. Reads invalidated
  while in flight are repeated before injection. Directory listing follows
  every page and starts no locations.
- `OPENCHAMBER_ASSISTANTS_ENABLED=false` disables registration and capability
  advertising at server startup. `?assistants=off` changes local navigation only;
  canonical conversations keep their identity for background messages.
- Managed web and Electron servers supply the hook, including to hosted and
  Capacitor clients. External OpenCode and VS Code's own lifecycle receive no
  managed plugins.
- Electron packaging retains the prompt Markdown and checks its presence in
  the archive. OpenCode itself reads only the generated JavaScript plugin.

## Decisions

### Why a context hook instead of an agent definition

OpenCode 2.2.5 exposes mutable `event.system` and session get/list in plugins.
The hook runs before provider dispatch regardless of the sender or selected
agent. An agent definition would require every sender to select it and could
leak into children through agent selection. A fixed system prefix preserves
prompt-cache reuse across turns and stays outside growing message history.

### Why no scratchpad identity file

Directory instructions reach every session using that folder. Assistant identity
belongs to the canonical conversation, so creation writes no `AGENTS.md`.
Deployments must remove assistant identity text from existing scratchpad
`AGENTS.md` files. Keep unrelated workspace instructions and notes.
