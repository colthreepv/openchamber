import { describe, it, expect, afterEach, vi } from 'vitest';
import { createAssistantMemoryActions, resolveAssistantMemoryScope } from './assistant-memory.js';
import { openMessageSearchStore, toMatchExpression, buildSnippet } from '../message-search/store.js';
import { loadSqliteOpener } from '../message-search/sqlite.js';
import { createOpenChamberControlService } from './service.js';

const session = (id, directory, canonical = false, starter = null, created = 1) => ({
  id, location: { directory }, time: { created },
  metadata: { openchamber: { assistant: canonical ? { name: id, canonical: true } : undefined, startedBy: starter ? { sessionID: starter } : null } },
});
const sessions = [session('a', '/a', true), session('new', '/a', true, null, 2), session('work', '/work', false, 'a'), session('alias-work', '/work', false, 'new'), session('other', '/a'), session('b', '/b', true)];
const stores = [];
afterEach(() => { for (const store of stores.splice(0)) store.close(); });
const setup = (overrides = {}) => {
  const store = openMessageSearchStore(loadSqliteOpener()(':memory:'));
  stores.push(store);
  for (const s of sessions) store.upsertSession({ id: s.id, directory: s.location.directory, title: `Title ${s.id}` });
  const rows = [
    ['u1', 'a', 'user', 10, 'Remember postgres'], ['r1', 'a', 'assistant', 11, 'Use postgres 17'],
    ['r2', 'a', 'assistant', 12, 'postgres confirmed'], ['u2', 'a', 'user', 13, 'Next postgres question'],
    ['w1', 'work', 'user', 15, 'postgres work'], ['x1', 'other', 'user', 20, 'postgres private'],
  ].map(([id, sessionId, role, createdAt, text]) => ({ id, sessionId, role, createdAt, text }));
  store.putMessages(rows);
  const index = { backfill: { state: 'done' } };
  const messageSearch = {
    status: async () => ({ state: 'on' }),
    search: (input) => {
      const match = toMatchExpression(input.query);
      if (!match) return { status: 'query-too-short', hits: [] };
      return { status: 'ok', hits: store.search({ ...input, match }).map((hit) => ({ ...hit, snippet: buildSnippet(hit.text, [input.query]) })), index };
    },
    zoom: (input) => ({ messages: store.exchange(input), index }),
    ...overrides.messageSearch,
  };
  const list = vi.fn(async () => ({ data: sessions }));
  const actions = createAssistantMemoryActions({ getClient: async () => ({ session: { list } }), messageSearch,
    readSettings: async () => ({ messageSearchEnabled: true, ...overrides.settings }) });
  return { store, actions, messageSearch, list, index };
};

describe('assistant memory scope', () => {
  it('uses the oldest canonical, including its duplicate marker starters, independent of list order', () => {
    for (const caller of ['a', 'new', 'work', 'alias-work']) {
      expect(resolveAssistantMemoryScope([...sessions].reverse(), caller)).toEqual({ assistantSessionId: 'a', sessionIds: ['a', 'alias-work', 'work'] });
    }
  });
  it('refuses unrelated sessions even in the assistant directory', () => {
    expect(() => resolveAssistantMemoryScope(sessions, 'other')).toThrow('not linked');
  });
});

describe('assistant memory actions with SQLite', () => {
  it('scopes node zoom to the resolved canonical and reuses raw exchange zoom for leaves', async () => {
    const { messageSearch } = setup();
    const zoom = vi.fn(async (_session, id) => id === 'mem:1:0'
      ? { children: [{ id: 'mem:0:0' }, { id: 'mem:0:1' }] }
      : { messageId: 'u1' });
    const actions = createAssistantMemoryActions({ getClient: async () => ({ session: { list: async () => ({ data: sessions }) } }),
      messageSearch, memoryTree: { zoom }, readSettings: async () => ({ messageSearchEnabled: true }) });
    expect((await actions.execute('memory.zoom', { nodeId: 'mem:1:0', sessionId: 'other' }, 'work')).children).toHaveLength(2);
    expect(zoom).toHaveBeenCalledWith('a', 'mem:1:0');
    expect((await actions.execute('memory.zoom', { nodeId: 'mem:0:0', sessionId: 'other' }, 'work')).messages.map((m) => m.id)).toEqual(['u1', 'r1', 'r2']);
  });
  it('recalls only scoped sessions, newest first, with inclusive date bounds and readable matches', async () => {
    const { actions } = setup();
    const result = await actions.execute('memory.recall', { query: 'postgres', since: 11, until: 15 }, 'work');
    expect(result.hits.map((h) => h.id)).toEqual(['w1', 'u2', 'r2', 'r1']);
    expect(result.hits[0]).toMatchObject({ sessionTitle: 'Title work', role: 'user', snippet: '«postgres» work' });
    expect(result.warning).toBeUndefined();
    expect((await actions.execute('memory.recall', { query: 'missing' }, 'a')).hits).toEqual([]);
  });
  it('zooms the opening user message and every settled reply, stopping before the next user', async () => {
    const { actions } = setup();
    for (const messageId of ['u1', 'r1', 'r2']) {
      const result = await actions.execute('memory.zoom', { sessionId: 'a', messageId }, 'a');
      expect(result.messages.map((m) => m.id)).toEqual(['u1', 'r1', 'r2']);
    }
    await expect(actions.execute('memory.zoom', { sessionId: 'other', messageId: 'x1' }, 'a')).rejects.toThrow('outside');
    await expect(actions.execute('memory.zoom', { sessionId: 'a', messageId: 'absent' }, 'a')).rejects.toThrow('not in the index');
  });
  it.each([{ agentMemoryToolEnabled: false }, { messageSearchEnabled: false }])('refuses disabled settings %j', async (settings) => {
    const { actions, list } = setup({ settings });
    await expect(actions.execute('memory.recall', { query: 'postgres' }, 'a')).rejects.toThrow(/disabled|Settings → Chat/);
    expect(list).not.toHaveBeenCalled();
  });
  it('refuses an unavailable index and too-short query without claiming no matches', async () => {
    const { actions, messageSearch } = setup();
    await expect(actions.execute('memory.recall', { query: 'a' }, 'a')).rejects.toThrow('query-too-short');
    messageSearch.status = async () => ({ state: 'failed' });
    await expect(actions.execute('memory.recall', { query: 'postgres' }, 'a')).rejects.toThrow('Settings → Chat');
  });
  it('dispatches recall and zoom through the control service without requiring saved-fact storage', async () => {
    const { messageSearch } = setup();
    const service = createOpenChamberControlService({
      messageSearch, readSettingsFromDiskMigrated: async () => ({ messageSearchEnabled: true }),
      buildOpenCodeUrl: () => 'http://localhost:1/api/info', getOpenCodeAuthHeaders: () => ({}),
      createClient: () => ({ session: { list: async () => ({ data: sessions }) } }),
    });
    const recalled = await service.execute('memory.recall', { query: 'postgres' }, '/spoofed', { contextSessionId: 'work' });
    expect(recalled.hits[0].id).toBe('w1');
    const zoomed = await service.execute('memory.zoom', { sessionId: 'a', messageId: 'r1' }, undefined, { contextSessionId: 'work' });
    expect(zoomed.messages.map((m) => m.id)).toEqual(['u1', 'r1', 'r2']);
  });
  it('follows every session page and fails closed on a repeated cursor', async () => {
    const { actions, list } = setup();
    list.mockResolvedValueOnce({ data: sessions.slice(0, 2), cursor: { next: 'page2' } })
      .mockResolvedValueOnce({ data: sessions.slice(2) });
    expect((await actions.execute('memory.recall', { query: 'postgres', limit: 1 }, 'work')).hits).toHaveLength(1);
    expect(list).toHaveBeenLastCalledWith({ parentID: null, limit: 200, cursor: 'page2' });
    list.mockResolvedValue({ data: sessions, cursor: { next: 'loop' } });
    await expect(actions.execute('memory.recall', { query: 'postgres' }, 'a')).rejects.toThrow('pagination repeated');
  });
  it('ignores opaque metadata on unrelated sessions instead of rejecting the whole page', async () => {
    const { actions, list } = setup();
    list.mockResolvedValue({ data: [...sessions, ...['text', { openchamber: [] }, { openchamber: { startedBy: 'another plugin' } }].map((metadata, i) => ({ ...session(`opaque${i}`, '/other'), metadata }))] });
    expect((await actions.execute('memory.recall', { query: 'postgres' }, 'work')).hits.map((h) => h.id)).toEqual(['w1', 'u2', 'r2', 'r1', 'u1']);
  });
  it('preserves failed scope reads and warns about incomplete indexing', async () => {
    const { actions, index, list } = setup();
    index.backfill.state = 'running';
    expect((await actions.execute('memory.recall', { query: 'postgres' }, 'a')).warning).toContain('incomplete');
    index.backfill.state = 'done';
    index.failures = 1;
    expect((await actions.execute('memory.recall', { query: 'missing' }, 'a')).warning).toContain('failed reads');
    list.mockRejectedValue(new Error('OpenCode offline'));
    await expect(actions.execute('memory.recall', { query: 'postgres' }, 'a')).rejects.toThrow('offline');
  });
});
