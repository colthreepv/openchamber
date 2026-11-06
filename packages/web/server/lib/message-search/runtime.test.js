import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMessageSearchRuntime } from './runtime.js';
import { openMessageSearchStore } from './store.js';
import { loadSqliteOpener } from './sqlite.js';

// The hub as the runtime sees it: who is listening, nothing else. It stays
// disconnected so no background walk reaches for an OpenCode.
const createHub = () => {
  const listeners = { event: 0, status: 0 };
  return {
    listeners,
    subscribeEvent: () => {
      listeners.event += 1;
      return () => { listeners.event -= 1; };
    },
    subscribeStatus: () => {
      listeners.status += 1;
      return () => { listeners.status -= 1; };
    },
    isConnected: () => false,
  };
};

describe('message search runtime', () => {
  let dataDir;
  let hub;
  const indexFile = () => path.join(dataDir, 'message-search.sqlite');
  const create = (enabled, reasoning = false) => createMessageSearchRuntime({
    dataDir,
    buildOpenCodeUrl: () => 'http://127.0.0.1:1/',
    getOpenCodeAuthHeaders: () => ({}),
    globalEventHub: hub,
    readSettings: async () => ({ enabled, reasoning }),
    logger: { warn: () => {} },
  });

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'message-search-runtime-'));
    hub = createHub();
  });
  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('does nothing while the setting is off: no file, no listener, no answers', async () => {
    const runtime = create(false);
    const status = await runtime.status();
    expect(status).toEqual({ state: 'off', sizeBytes: 0, index: null });
    expect(fs.existsSync(indexFile())).toBe(false);
    expect(hub.listeners).toEqual({ event: 0, status: 0 });
    expect(runtime.search({ query: 'anything', limit: 5 })).toBeNull();
  });

  it('forwards assistant scope and dates to the store and reads indexed exchanges', async () => {
    const runtime = create(true);
    await runtime.status();
    const store = openMessageSearchStore(loadSqliteOpener()(indexFile()));
    try {
      for (const id of ['a', 'b']) store.upsertSession({ id, directory: `/${id}`, title: id });
      store.putMessages([
        { id: 'u1', sessionId: 'a', role: 'user', createdAt: 1, text: 'postgres user' },
        { id: 'r1', sessionId: 'a', role: 'assistant', createdAt: 2, text: 'postgres reply' },
        { id: 'r1:reasoning', messageId: 'r1', sessionId: 'a', role: 'reasoning', createdAt: 2, text: 'postgres reasoning' },
        { id: 'u2', sessionId: 'a', role: 'user', createdAt: 3, text: 'next turn' },
        { id: 'b1', sessionId: 'b', role: 'user', createdAt: 2, text: 'postgres other' },
      ]);
      const result = runtime.search({ query: 'postgres', sessionIds: ['a'], since: 2, until: 2, limit: 10, includeReasoning: false });
      expect(result.hits.map((h) => h.id)).toEqual(['r1']);
      expect(runtime.search({ query: 'postgres', sessionIds: [], limit: 10 }).hits).toEqual([]);
      expect(runtime.zoom({ sessionId: 'a', messageId: 'r1' }).messages.map((m) => m.id)).toEqual(['u1', 'r1']);
    } finally {
      store.close();
      await runtime.stop();
    }
    expect(runtime.zoom({ sessionId: 'a', messageId: 'r1' })).toBeNull();
  });

  it('rebuilds the derived pre-exchange schema so empty user boundaries are reindexed', () => {
    const connection = loadSqliteOpener()(indexFile());
    const store = openMessageSearchStore(connection);
    store.upsertSession({ id: 'old', directory: '/old' });
    store.putMessages([{ id: 'reply', sessionId: 'old', role: 'assistant', createdAt: 2, text: 'old reply' }]);
    store.writeMeta('schema', '3');
    store.close();
    const rebuilt = openMessageSearchStore(loadSqliteOpener()(indexFile()));
    try {
      expect(rebuilt.counts()).toEqual({ sessions: 0, messages: 0 });
      expect(rebuilt.readMeta('schema')).toBe('4');
    } finally { rebuilt.close(); }
  });

  it('starts from the saved setting and follows it afterwards, keeping the file when switched off', async () => {
    const runtime = create(true);
    expect((await runtime.status()).state).toBe('on');
    expect(hub.listeners).toEqual({ event: 1, status: 1 });
    expect(runtime.search({ query: 'anything', limit: 5 })).toMatchObject({ status: 'ok', hits: [] });

    await runtime.setEnabled(false);
    const off = await runtime.status();
    expect(off.state).toBe('off');
    expect(off.sizeBytes).toBeGreaterThan(0);
    expect(hub.listeners).toEqual({ event: 0, status: 0 });
    expect(runtime.search({ query: 'anything', limit: 5 })).toBeNull();

    await runtime.setEnabled(true);
    expect((await runtime.status()).state).toBe('on');
    expect(hub.listeners).toEqual({ event: 1, status: 1 });
    await runtime.stop();
  });

  it('deletes the file while off, and starts a fresh index when deleted while on', async () => {
    const runtime = create(true);
    await runtime.setEnabled(false);
    expect(fs.existsSync(indexFile())).toBe(true);
    await runtime.deleteIndex();
    expect(fs.existsSync(indexFile())).toBe(false);
    expect(await runtime.status()).toEqual({ state: 'off', sizeBytes: 0, index: null });

    await runtime.setEnabled(true);
    await runtime.deleteIndex();
    const rebuilt = await runtime.status();
    expect(rebuilt.state).toBe('on');
    expect(rebuilt.index).toMatchObject({ sessions: 0, messages: 0 });
    expect(hub.listeners).toEqual({ event: 1, status: 1 });
    await runtime.stop();
    expect(hub.listeners).toEqual({ event: 0, status: 0 });
  });

  it('records whether reasoning is indexed and follows its switch only while search runs', async () => {
    const runtime = create(true);
    await runtime.status();
    await runtime.setReasoningEnabled(true);
    await runtime.setEnabled(false);
    await runtime.setReasoningEnabled(false);
    await runtime.setEnabled(true);
    expect((await runtime.status()).state).toBe('on');
    await runtime.stop();

    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(indexFile(), { readOnly: true });
    expect(db.prepare("SELECT value FROM meta WHERE key = 'reasoning'").get().value).toBe('0');
    db.close();
  });
});
