import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadSqliteOpener } from '../message-search/sqlite.js';
import { openMessageSearchStore } from '../message-search/store.js';
import { openAssistantMemoryStore } from './store.js';
import { createAssistantMemoryRuntime } from './runtime.js';
import { bytes, clip, dueMerges, exchangesFromMessages, nodeId, parseBatch, reconcileTree, renderView } from './tree.js';

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const session = { id: 'canonical', location: { directory: '/assistant' }, model: { providerID: 'anthropic', id: 'sonnet' }, metadata: { openchamber: { assistant: { name: 'Ada', canonical: true } } } };
const messages = (count, long = false) => Array.from({ length: count }, (_, i) => [
  { id: `u${i}`, role: 'user', createdAt: i * 10, text: `Keep path /repo/${i}` },
  { id: `a${i}`, role: 'assistant', createdAt: i * 10 + 1, text: long ? 'reply '.repeat(400) : 'Done' },
]).flat();
const setup = async ({ rows = messages(2), generate, settings: extra = {}, waitMs = 3000, isTreeOwner } = {}) => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-tree-'));
  cleanups.push(() => fs.rm(dataDir, { recursive: true, force: true }));
  const settings = { messageSearchEnabled: true, ...extra };
  const search = { memoryMessages: () => rows, status: async () => ({ state: 'on' }) };
  const runtime = createAssistantMemoryRuntime({ dataDir, messageSearch: search, readSettings: async () => settings, generate, waitMs, isTreeOwner });
  cleanups.push(() => runtime.stop());
  return { runtime, settings, search, dataDir };
};

describe('persistent assistant memory', () => {
  it('survives a search schema rebuild and reopens without losing summaries', async () => {
    const { dataDir } = await setup();
    const open = loadSqliteOpener();
    const file = path.join(dataDir, 'durable.sqlite');
    const store = openAssistantMemoryStore(open(file));
    const leaf = exchangesFromMessages(messages(1))[0];
    store.put('s', [leaf]);
    store.close();
    const index = open(path.join(dataDir, 'message-search.sqlite'));
    const derived = openMessageSearchStore(index);
    derived.writeMeta('schema', 'obsolete'); derived.close();
    openMessageSearchStore(open(path.join(dataDir, 'message-search.sqlite'))).close();
    const reopened = openAssistantMemoryStore(open(file));
    expect(reopened.get('s', 0, 0).source).toBe(leaf.source);
    reopened.close();
  });
  it('schedules only built siblings and invalidates a reverted suffix and its ancestors', () => {
    const store = openAssistantMemoryStore(loadSqliteOpener()(':memory:'));
    const leaves = exchangesFromMessages(messages(4));
    expect(dueMerges(leaves.slice(0, 1), 1)).toEqual([]);
    const parents = dueMerges(leaves, 1);
    expect(parents.map((n) => n.index)).toEqual([0, 1]);
    store.put('s', [...leaves, ...parents, ...dueMerges([...leaves, ...parents], 2)]);
    expect(dueMerges(store.list('s'), 1)).toEqual([]);
    reconcileTree(store, 's', leaves.slice(0, 3));
    expect(store.list('s').map((n) => nodeId(n.level, n.index))).toEqual(['mem:0:0', 'mem:0:1', 'mem:0:2', 'mem:1:0']);
    store.close();
  });
  it('parses fenced arrays and JSONL, rejecting extra and duplicate IDs', () => {
    expect([...parseBatch('```json\n[{"id":"u1","text":"yes"},{"id":"extra","text":"no"}]\n```', ['u1', 'u2'])]).toEqual([['u1', 'yes']]);
    expect([...parseBatch('{"id":"a","text":"one"}\nnoise\n{"id":"a","text":"two"}', ['a'])]).toEqual([]);
    expect(clip('é😀x', 5)).toBe('é');
    expect(bytes(clip('é😀x', 6))).toBe(6);
  });
  it('merges oldest siblings to fit the whole view, preserving recent detail', () => {
    const leaves = exchangesFromMessages(messages(8)).map((e) => ({ ...e, text: 'x'.repeat(600) }));
    const nodes = [...leaves];
    for (let level = 1; level <= 3; level++) nodes.push(...dueMerges(nodes, level).map((e) => ({ ...e, text: 'merged' })));
    const view = renderView(nodes, leaves, 2500);
    expect(bytes(view)).toBeLessThanOrEqual(2500);
    expect(view).toContain('mem:2:0');
    expect(view).toContain('mem:0:7');
    expect(renderView(leaves, leaves, 500)).toBeNull();
    expect(renderView([], leaves)).toBeNull();
  });
  it('builds short exchanges with no call and opens parents and leaves', async () => {
    const generate = vi.fn();
    const { runtime } = await setup({ generate });
    expect((await runtime.checkpoint(session)).summary).toContain('user: Keep path /repo/0');
    expect(generate).not.toHaveBeenCalled();
    expect((await runtime.zoom(session.id, 'mem:1:0')).children.map((n) => n.id)).toEqual(['mem:0:0', 'mem:0:1']);
    expect(await runtime.zoom(session.id, 'mem:0:0')).toMatchObject({ messageId: 'u0' });
  });
  it('refuses alias canonicals whose checkpoint node IDs would resolve to another owner', async () => {
    const generate = vi.fn();
    const { runtime } = await setup({ generate, isTreeOwner: async (id) => id === 'canonical' });
    expect(await runtime.checkpoint({ ...session, id: 'alias' })).toBeNull();
    expect(await runtime.checkpoint(session)).toHaveProperty('summary');
    expect(generate).not.toHaveBeenCalled();
  });
  it('clips the first paid output if shortening fails', async () => {
    const generate = vi.fn().mockResolvedValueOnce({ providerID: 'p', modelID: 'm', text: JSON.stringify([{ id: 'u0', text: 'é'.repeat(1000) }]) }).mockRejectedValueOnce(new Error('offline'));
    const { runtime } = await setup({ rows: messages(1, true), generate });
    expect(await runtime.checkpoint(session)).toHaveProperty('summary');
    expect(bytes((await runtime.zoom(session.id, 'mem:0:0')).node.text)).toBeLessThanOrEqual(1024);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('does not let an oversized exchange block unrelated leaves', async () => {
    const rows = messages(2); rows[1].text = 'x'.repeat(100_000);
    const { runtime } = await setup({ rows, generate: vi.fn() });
    const result = await runtime.checkpoint(session);
    expect(result.summary).toContain('mem:0:1');
    expect(result.summary).toContain('not summarized yet');
    expect((await runtime.zoom(session.id, 'mem:0:1')).node.model).toBe('verbatim');
  });
  it('batches leaves, retries over-budget output once, clips UTF-8 and preserves short user text', async () => {
    const generate = vi.fn(async ({ prompt }) => {
      const inputs = JSON.parse(prompt.match(/<input>(.*)<\/input>/s)[1]);
      return { providerID: 'anthropic', modelID: 'haiku', text: JSON.stringify(inputs.map((i) => ({ id: i.id, text: 'é'.repeat(1000) }))) };
    });
    const { runtime } = await setup({ rows: messages(2, true), generate, settings: { assistantMemoryModel: 'anthropic/haiku', assistantMemoryVariant: 'high' } });
    expect(await runtime.checkpoint(session)).toHaveProperty('summary');
    expect(generate).toHaveBeenCalledTimes(4); // leaves + shorten, merge + shorten
    expect(generate.mock.calls[0][0]).toMatchObject({ model: 'anthropic/haiku', variant: 'high', onOverflow: 'error' });
    const leaf = (await runtime.zoom(session.id, 'mem:0:0')).node;
    expect(leaf.text.startsWith('user: Keep path /repo/0\n')).toBe(true);
    expect(bytes(leaf.text)).toBeLessThanOrEqual(1024);
    expect(leaf.model).toBe('anthropic/haiku');
    expect(bytes((await runtime.zoom(session.id, 'mem:1:0')).node.text)).toBeLessThanOrEqual(512);
  });
  it('backs off missing lines and failures without a hot retry on compaction', async () => {
    const generate = vi.fn(async () => { throw new Error('offline'); });
    const { runtime } = await setup({ rows: messages(1, true), generate });
    expect(await runtime.checkpoint(session)).toBeNull();
    expect(await runtime.checkpoint(session)).toBeNull();
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('retains partial batch success and zoom markers for missing IDs', async () => {
    const generate = vi.fn(async () => ({ providerID: 'p', modelID: 'm', text: '[{"id":"u0","text":"reply: found"},{"id":"extra","text":"ignored"}]' }));
    const { runtime } = await setup({ rows: messages(2, true), generate });
    const result = await runtime.checkpoint(session);
    expect(result.summary).toContain('mem:0:1');
    expect(result.summary).toContain('not summarized yet');
    expect((await runtime.zoom(session.id, 'mem:0:1')).messageId).toBe('u1');
    await runtime.checkpoint(session);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('serializes repeated triggers and concurrent canonical sessions globally', async () => {
    let finish;
    const generate = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { runtime } = await setup({ rows: messages(1, true), generate, waitMs: 5 });
    await runtime.checkpoint(session);
    runtime.schedule(session);
    await runtime.checkpoint({ ...session, id: 'second' });
    expect(generate).toHaveBeenCalledTimes(1);
    finish({ providerID: 'p', modelID: 'm', text: '[{"id":"u0","text":"reply: done"}]' });
    // Resolve any second session generation before teardown waits for it.
    generate.mockImplementation(async () => ({ providerID: 'p', modelID: 'm', text: '[{"id":"u0","text":"reply: done"}]' }));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  it.each([{ messageSearchEnabled: false }, { agentMemoryToolEnabled: false }, { assistantMemoryTreeEnabled: false }])('gates all tree work for %j', async (settings) => {
    const generate = vi.fn();
    const { runtime } = await setup({ generate, settings });
    runtime.schedule(session);
    expect(await runtime.checkpoint(session)).toBeNull();
    expect(await runtime.zoom(session.id, 'mem:0:0')).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
  it('refuses work and unrelated sessions, preserves paid data during an incomplete rebuild', async () => {
    const { runtime, search } = await setup();
    expect(await runtime.checkpoint({ ...session, metadata: {} })).toBeNull();
    expect(await runtime.checkpoint({ ...session, parentID: 'parent' })).toBeNull();
    await runtime.checkpoint(session);
    search.memoryMessages = () => null;
    expect(await runtime.checkpoint(session)).toBeNull();
    search.memoryMessages = () => messages(2);
    expect((await runtime.zoom(session.id, 'mem:0:0')).messageId).toBe('u0');
  });
  it('bounds compaction wait and rejects a generation completed after a revert', async () => {
    let finish;
    const generate = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    const { runtime, search } = await setup({ rows: messages(1, true), generate, waitMs: 5 });
    expect(await runtime.checkpoint(session)).toBeNull();
    search.memoryMessages = () => [];
    finish({ text: '[{"id":"u0","text":"old reply"}]', providerID: 'p', modelID: 'm' });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await runtime.zoom(session.id, 'mem:0:0')).toBeNull();
  });
});
