import { z } from 'zod';
import { OpenChamberControlError } from './error.js';
import { MATCH_START, MATCH_END } from '../message-search/store.js';

const marker = z.object({ name: z.string().trim().min(1), canonical: z.literal(true) });
const namespacedMarker = z.object({ openchamber: z.object({ assistant: marker }) });
const legacyMarker = z.object({ assistant: marker });
const starterMetadata = z.object({ openchamber: z.object({ startedBy: z.object({ sessionID: z.string().trim().min(1) }) }) });
const starterId = (session) => starterMetadata.safeParse(session.metadata).data?.openchamber.startedBy.sessionID;
const sessionSchema = z.object({
  id: z.string().min(1), parentID: z.string().nullish(),
  location: z.object({ directory: z.string() }),
  time: z.object({ created: z.number() }),
  metadata: z.unknown().optional(),
});
const pageSchema = z.object({ data: z.array(sessionSchema), cursor: z.object({ next: z.string().nullish() }).nullish() });
const fail = (message, status = 400) => { throw new OpenChamberControlError(message, status); };
const directoryKey = (value) => value.replaceAll('\\', '/').replace(/\/+$/, '');

// Only recorded starters confer access. Sharing a directory confers none.
export const resolveAssistantMemoryScope = (sessions, callerId) => {
  const canonicals = sessions.filter((s) => !s.parentID && (namespacedMarker.safeParse(s.metadata).success || legacyMarker.safeParse(s.metadata).success));
  const byId = new Map(canonicals.map((s) => [s.id, s]));
  const caller = sessions.find((s) => s.id === callerId && !s.parentID);
  const candidate = caller && (byId.get(caller.id) ?? byId.get(starterId(caller)));
  if (!candidate) fail('This session is not linked to an assistant; assistant memory is unavailable.', 403);
  const aliases = canonicals.filter((s) => directoryKey(s.location.directory) === directoryKey(candidate.location.directory))
    .sort((a, b) => a.time.created - b.time.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const aliasIds = new Set(aliases.map((s) => s.id));
  const canonical = aliases[0];
  return { assistantSessionId: canonical.id, sessionIds: [canonical.id, ...sessions.filter((s) => !s.parentID && !aliasIds.has(s.id) && aliasIds.has(starterId(s))).map((s) => s.id)] };
};

const inputSchema = z.object({
  query: z.string().trim().min(1).max(2000).optional(),
  since: z.number().int().nonnegative().optional(), until: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional(),
  sessionId: z.string().trim().min(1).optional(), messageId: z.string().trim().min(1).optional(),
  nodeId: z.string().trim().max(64).optional(),
});
const SEARCH_OFF = 'Memory search is off or unavailable. The user can enable message search in Settings → Chat.';
const progress = (index) => index?.backfill?.state === 'done' && !index.failures && !index.listFailed
  ? {} : { warning: 'The index is backfilling, unfinished, or has failed reads. Results may be incomplete.' };

export const listAssistantMemorySessions = async (client) => {
  const sessions = [];
  const seen = new Set();
  let cursor;
  for (;;) {
    const input = { parentID: null, limit: 200 };
    if (cursor) input.cursor = cursor;
    const page = pageSchema.parse(await client.session.list(input));
    sessions.push(...page.data);
    const next = page.cursor?.next;
    if (!next) return sessions;
    if (seen.has(next)) fail('Could not resolve assistant scope: session pagination repeated.', 503);
    seen.add(next);
    cursor = next;
  }
};

export const createAssistantMemoryActions = ({ getClient, messageSearch, readSettings, memoryTree }) => ({
  async execute(action, rawInput, callerId) {
    const settings = await readSettings();
    if (settings.agentMemoryToolEnabled === false) fail('The memory tool is disabled in Settings.', 403);
    if (!messageSearch || settings.messageSearchEnabled !== true) fail(SEARCH_OFF, 503);
    const status = await messageSearch.status();
    if (status.state !== 'on') fail(SEARCH_OFF, 503);
    const parsed = inputSchema.safeParse(rawInput);
    if (!parsed.success) fail(`Invalid memory input: ${parsed.error.message}`);
    const input = parsed.data;
    if (input.since !== undefined && input.until !== undefined && input.since > input.until) fail('since must be at or before until');
    const client = await getClient();
    const sessions = await listAssistantMemorySessions(client);
    const scope = resolveAssistantMemoryScope(sessions, callerId);
    if (action === 'memory.recall') {
      if (!input.query) fail('recall requires query');
      const result = messageSearch.search({ query: input.query, sessionIds: scope.sessionIds, since: input.since, until: input.until, limit: Math.min(input.limit ?? 10, 50), includeReasoning: false });
      if (!result) fail(SEARCH_OFF, 503);
      if (result.status === 'query-too-short') fail('query-too-short: use at least one word of 3 or more characters.');
      return { assistantSessionId: scope.assistantSessionId, status: result.status, hits: result.hits.map((hit) => ({ ...hit, snippet: hit.snippet.replaceAll(MATCH_START, '«').replaceAll(MATCH_END, '»') })), ...progress(result.index) };
    }
    if (input.nodeId) {
      const target = await memoryTree?.zoom(scope.assistantSessionId, input.nodeId);
      if (!target) fail('The memory node is unavailable. Use recall to find the exchange.', 404);
      if (target.children) return { assistantSessionId: scope.assistantSessionId, ...target };
      input.sessionId = scope.assistantSessionId;
      input.messageId = target.messageId;
    }
    if (!input.sessionId || !input.messageId) fail('zoom requires nodeId or sessionId and messageId from a recall hit');
    if (!scope.sessionIds.includes(input.sessionId)) fail('The zoom target is outside this assistant\'s memory scope.', 403);
    const result = messageSearch.zoom(input);
    if (!result) fail(SEARCH_OFF, 503);
    if (!result.messages) fail('The exchange is not in the index yet or no longer exists. Retry recall after backfill.', 404);
    let remaining = 100_000;
    const messages = result.messages.map((message) => {
      const text = message.text.slice(0, remaining);
      remaining -= text.length;
      return { ...message, text: text.length < message.text.length ? `${text}\n[Exchange clipped at 100000 characters]` : text };
    });
    return { assistantSessionId: scope.assistantSessionId, messages, ...progress(result.index) };
  },
});
