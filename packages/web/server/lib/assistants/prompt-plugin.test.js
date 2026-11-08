import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { materializeAssistantPromptPlugin } from './prompt-plugin.js';
import { createManagedConfigRuntime } from '../opencode/managed-config-file.js';

const cleanup = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((fn) => fn())); });
const temporary = async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-assistants-'));
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
};
const session = (id, extra = {}) => ({
  id, location: { directory: '/assistants/alpha' }, time: { created: 1 },
  metadata: { openchamber: { assistant: { name: 'Alpha', role: 'a helpful assistant', canonical: true, version: 1 } } },
  ...extra,
});
const harness = async (records) => {
  const instanceDir = await temporary();
  const directory = await materializeAssistantPromptPlugin({ fsPromises: fs, path, instanceDir });
  const { default: plugin } = await import(pathToFileURL(path.join(directory, 'index.js')).href);
  expect(await fs.readFile(path.join(directory, 'index.js'), 'utf8')).not.toMatch(/import\s/);
  let wake;
  let acknowledge;
  let resolveAcknowledge;
  let nextEvent;
  let stopped = false;
  const hooks = new Map();
  const get = vi.fn(async ({ sessionID }) => records.find((entry) => entry.id === sessionID));
  const list = vi.fn(async () => ({ data: records, cursor: {} }));
  const dispose = await plugin.setup({
    session: { get, list, hook: async (name, hook) => { hooks.set(name, hook); } },
    event: { subscribe: ({ signal }) => {
      signal.addEventListener('abort', () => { stopped = true; wake?.(); }, { once: true });
      return { async *[Symbol.asyncIterator]() {
        while (!stopped) {
          await new Promise((resolve) => { wake = resolve; });
          if (stopped) return;
          yield nextEvent;
          resolveAcknowledge();
        }
      } };
    } },
  });
  cleanup.push(dispose);
  return {
    hooks, get, list,
    emit: async (event) => {
      acknowledge = new Promise((resolve) => { resolveAcknowledge = resolve; });
      nextEvent = event; wake(); await acknowledge;
    },
    run: async (id) => {
      const draft = { sessionID: id, system: [{ type: 'text', text: 'stock' }], messages: [] };
      await hooks.get('context')(draft);
      return draft;
    },
  };
};

describe('assistant prompt plugin', () => {
  it('adds the metadata-templated stable prefix on every primary turn, without touching history', async () => {
    const h = await harness([session('canonical')]);
    const first = await h.run('canonical');
    expect(first.system[0].text).toContain('You are Alpha, a helpful assistant.');
    expect(first.system[0].text).toContain('`session.create`, `returnResult: true`');
    expect(first.system[1].text).toBe('stock');
    expect(first.messages).toEqual([]);
    expect((await h.run('canonical')).system).toEqual(first.system);
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.list).toHaveBeenCalledTimes(1);
    expect([...h.hooks.keys()]).toEqual(['context']);
  });

  it('excludes same-directory work, subagents, ordinary sessions and archived assistants', async () => {
    const records = [session('canonical'),
      session('work', { metadata: { openchamber: { startedBy: { sessionID: 'canonical' } } } }),
      session('copied-work'), session('subagent', { parentID: 'canonical' }),
      session('ordinary', { metadata: {} }), session('archived', { time: { created: 0, archived: 2 } })];
    records[2].metadata.openchamber.startedBy = { sessionID: 'canonical' };
    const h = await harness(records);
    for (const id of ['work', 'copied-work', 'subagent', 'ordinary', 'archived']) {
      expect((await h.run(id)).system).toEqual([{ type: 'text', text: 'stock' }]);
    }
    expect(h.list).not.toHaveBeenCalled();
  });

  it('selects the oldest marker across pages and breaks ties by ID', async () => {
    const h = await harness([session('newer', { time: { created: 2 } }), session('b'), session('a')]);
    h.list.mockImplementation(async ({ cursor }) => cursor
      ? { data: [session('a')], cursor: {} }
      : { data: [session('newer', { time: { created: 2 } }), session('b')], cursor: { next: 'page2' } });
    expect((await h.run('newer')).system).toHaveLength(1);
    expect((await h.run('b')).system).toHaveLength(1);
    expect((await h.run('a')).system).toHaveLength(2);
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it('refreshes metadata and canonical selection after identity events', async () => {
    const records = [session('canonical')];
    const h = await harness(records);
    await h.run('canonical');
    records[0] = session('canonical', { metadata: { openchamber: { assistant: { name: 'Beta', role: 'helper', canonical: true } } } });
    await h.emit({ type: 'session.metadata.updated' });
    expect((await h.run('canonical')).system[0].text).toContain('You are Beta, helper.');
    records.unshift(session('older', { time: { created: 0 } }));
    await h.emit({ type: 'session.created' });
    expect((await h.run('canonical')).system).toHaveLength(1);
  });

  it('leaves identity replacements literal and rejects malformed markers', async () => {
    const records = [session('canonical', { metadata: { openchamber: { assistant: {
      name: '{role} $&', role: 'helper', canonical: true,
    } } } }), session('invalid', { metadata: { openchamber: { assistant: { name: 7, canonical: true } } } })];
    const h = await harness(records);
    expect((await h.run('canonical')).system[0].text).toContain('You are {role} $&, helper.');
    expect((await h.run('invalid')).system).toHaveLength(1);
  });

  it('retries failed reads without treating failure as an empty canonical list', async () => {
    const h = await harness([session('canonical')]);
    h.list.mockRejectedValueOnce(new Error('unavailable'));
    await expect(h.run('canonical')).rejects.toThrow('unavailable');
    expect((await h.run('canonical')).system).toHaveLength(2);
  });

  it('supports a canonical assistant with an empty role', async () => {
    const h = await harness([session('canonical', { metadata: { openchamber: { assistant: {
      name: 'Alpha', role: '', canonical: true,
    } } } })]);
    expect((await h.run('canonical')).system[0].text).toContain('You are Alpha.');
  });

  it('includes identity in the Claude Agent adapter instructions snapshot', async () => {
    const h = await harness([session('canonical')]);
    const event = { sessionID: 'canonical', model: { providerID: 'claude-agent' },
      system: [{ type: 'text', text: 'stock' }], options: { claudeCodeInstructions: 'user instructions' } };
    await h.hooks.get('context')(event);
    expect(event.options.claudeCodeInstructions).toBe(`${event.system[0].text}\n\nuser instructions`);
  });

  it('discards a canonical lookup invalidated while its pages were loading', async () => {
    const records = [session('canonical')];
    const h = await harness(records);
    let finish;
    h.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const running = h.run('canonical');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    records.unshift(session('older', { time: { created: 0 } }));
    await h.emit({ type: 'session.created' });
    finish({ data: [session('canonical')], cursor: {} });
    expect((await running).system).toHaveLength(1);
    expect(h.list).toHaveBeenCalledTimes(2);
  });

  it('registers only when the server-wide assistants feature is on', async () => {
    const instanceDir = await temporary();
    const build = async (env) => {
      const runtime = createManagedConfigRuntime({ fsPromises: fs, path, instanceDir, env, readSettings: () => ({}) });
      await runtime.buildManagedChildEnv();
      return JSON.parse(await fs.readFile(runtime.filePath, 'utf8'));
    };
    expect((await build({})).plugins.some((entry) => entry.endsWith('openchamber-assistant-prompt'))).toBe(true);
    expect((await build({ OPENCHAMBER_ASSISTANTS_ENABLED: 'false' })).plugins).toHaveLength(2);
  });

  it('includes identity in the existing external-config fallback without overwriting user content', async () => {
    const instanceDir = await temporary();
    const runtime = createManagedConfigRuntime({ fsPromises: fs, path, instanceDir,
      env: { OPENCODE_CONFIG: '/user/config.json', OPENCODE_CONFIG_CONTENT: '{"model":"test/model"}' },
      readSettings: () => ({}),
    });
    const child = await runtime.buildManagedChildEnv();
    const config = JSON.parse(child.OPENCODE_CONFIG_CONTENT);
    expect(child.OPENCODE_CONFIG).toBeUndefined();
    expect(config.model).toBe('test/model');
    expect(config.plugins.some((entry) => entry.endsWith('openchamber-assistant-prompt'))).toBe(true);
  });
});
