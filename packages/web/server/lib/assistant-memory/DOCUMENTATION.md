# Assistant conversation memory

## Ownership

The server owns paid-for summaries in `assistant-memory.sqlite`, independently
of the derived message-search index. The message-search indexer schedules a
build after a successful canonical-session sync. Work-session reports are
already part of the canonical conversation; work sessions create no leaves.
The managed agent-tool plugin requests a checkpoint over its existing
same-machine, per-child-token callback. External OpenCode and VS Code do not
load that plugin. Web, desktop, hosted mobile and Capacitor clients share the
connected server's implementation. There is no client-side model call or UI.

## Invariants

- Tree work requires `messageSearchEnabled: true`,
  `agentMemoryToolEnabled: true` (memory is off by default), and `assistantMemoryTreeEnabled`
  other than false. The dedicated kill switch defaults on. Settings live on
  the server and apply at use time; turning them off stops subsequent model
  calls and rejects in-flight writes. Existing summaries remain on disk.
- An exchange starts at an indexed user row and ends before the next user
  row, using the same ordering and exclusion of reasoning as recall zoom.
  Only settled reply text is present. Tools, attachments and reasoning are
  outside message search and therefore outside this tree.
- Leaves have a 1024-byte UTF-8 text budget. User text up to 400 bytes stays
  verbatim in the leaf, with reply summaries using the remaining budget.
  An exchange that fits uses its own text without a model call. Internal
  nodes combine adjacent siblings into 512 bytes. Source spans retain
  exchange indices, first/last message IDs and timestamps. Every built node
  records its model and creation time.
- The builder runs at most 1 session globally and 1 build per session.
  Progress is debounced 1500 ms. A batch handles up to 32 nodes and 96 KiB of
  source input, with 1 generation call and at most 1 shortening call per
  batch. Each level gets a batch. Missing lines and failures retry after
  60 seconds; repeated compaction requests cannot bypass that backoff.
  Generation has a 120-second deadline. An exchange larger than the input
  batch budget stays unresolved while other exchanges continue. Input is
  never silently truncated. A failed shortening attempt uses the paid first
  answer clipped to its UTF-8 byte budget.
- `assistantMemoryModel` selects an explicit `providerID/modelID` through
  OpenCode. `assistantMemoryVariant` selects its thinking variant, default
  `high`. Without an override the builder selects Haiku 5.5 on the canonical
  session's provider if listed, then falls back to normal Small Model
  resolution with that session's model and provider. A providerless session
  waits for a model selection. Unsupported thinking variants use the model
  default under Small Model's catalog validation. Adaptive thinking has no
  separate generate/text option. No credentials or provider calls exist here.
- Summaries use the existing Small Model boundary. Explicitly configured
  models and normal same-provider fallback stay inside enterprise mode's
  OpenCode boundary, with no new listener, provider entry or external service.
- A changed source fingerprint invalidates the first affected leaf's suffix
  and intersecting ancestors. In-flight writes compare the complete indexed
  source snapshot before committing. A session with incomplete/reset search
  state is unavailable, never an authoritative empty history. Rebuilding the
  derived index preserves paid summaries until that session finishes syncing.
- A checkpoint includes its format header and covers all indexed exchanges
  within 24 KiB. Oldest built adjacent siblings merge first. Unbuilt leaves
  have zoomable markers. If built parents cannot fit complete coverage, the
  checkpoint is unavailable. Compaction waits at most 3 seconds for the build;
  the plugin's callback deadline is 5 seconds. Errors, disabled settings,
  empty trees and noncanonical sessions leave OpenCode's result unset.
- The marker and oldest-canonical-per-directory alias rule jointly determine
  the tree owner, matching recall and zoom. Alias canonical sessions receive
  native compaction and create no duplicate tree. Reconnect schedules both
  freshly synced and already-current canonical sessions, resuming backlogs.
- The hook fails open when the latest turn contains tool calls/results,
  ends with a user message, lacks message IDs, or its first/last IDs do not
  match the final indexed exchange. This applies to precompute as well as
  manual and automatic compaction, because the hook exposes the same request
  shape. Native compaction preserves unfinished working state outside the
  text index. A tree checkpoint therefore replaces only covered text turns.
- The plugin sets only `result.summary`. OpenCode owns its verbatim-tail
  split and `metadata.keepID`. No per-turn prompt or history rewrite occurs.
- Node IDs `mem:<level>:<index>` are scoped to the caller's resolved canonical
  assistant, independently of any supplied session ID. Zoom opens 2 children
  or the original leaf exchange. IDs identify slots and can change meaning
  after a reverted tail is replaced, so old checkpoints are historical.

## Decisions

### Why summaries have a separate database

Message-search schema changes rebuild its derived file. Rebuilding summaries
would spend model tokens again. The summary schema uses additive changes and
refuses an unknown version instead of deleting data.

### Why batches have a fixed ceiling

Backfill may expose years of conversation. A 32-node, 96-KiB batch bounds
request size and postpones remaining work behind a 60-second pause. Short
exchanges and small merges use no generation call.

### Why an incomplete view falls back to OpenCode

A prefix-only checkpoint would claim to remember a conversation it did not
cover. Unresolved leaf markers retain pointers where possible; a view that
still exceeds the budget leaves native compaction in charge.

### Why there is no hot layer

This module owns tree memory only. `checkpoint` has a composition point for
future profile and open-loop state. Such state has no authority in this tree.
