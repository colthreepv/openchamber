import { beforeEach, describe, expect, test } from 'bun:test';
import { buildAssistantDirectory } from './assistantDirectory';
import { readLastAssistant, rememberAssistant, resolveAssistantDraft, resolveLandingAssistant } from './assistantLanding';
import type { Session } from '@/lib/opencode/model';

const projects = [
  { id: 'first', path: '/home/assistants/first' },
  { id: 'second', path: '/home/assistants/second' },
  { id: 'missing', path: '/home/assistants/missing' },
];
const session = (id: string, directory: string, updated: number): Session => ({
  id, directory, projectID: id, title: id, cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated },
  metadata: { openchamber: { assistant: { name: id, role: '', canonical: true, version: 1 } } },
});
const directory = buildAssistantDirectory(projects, [
  session('one', projects[0].path, 1), session('two', projects[1].path, 10),
], '/home');

describe('assistant landing', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
  });
  test('last selection is scoped to runtime; transient runtime does not persist', () => {
    rememberAssistant('second', 'server-a');
    rememberAssistant('first', 'server-b');
    rememberAssistant('missing', '');
    expect(readLastAssistant('server-a')).toBe('second');
    expect(readLastAssistant('server-b')).toBe('first');
    expect(readLastAssistant('')).toBeNull();
  });
  test('last used wins; fallback follows registry order rather than activity', () => {
    const order = projects.map((item) => item.id);
    expect(resolveLandingAssistant(directory.assistants, order, 'second')?.projectId).toBe('second');
    expect(resolveLandingAssistant(directory.assistants, order, 'deleted')?.projectId).toBe('first');
    expect(resolveLandingAssistant([], order, null)).toBeNull();
  });
  test('only a draft in a canonical assistant workspace redirects', () => {
    expect(resolveAssistantDraft(directory.assistants, 'second', '/home/assistants/first/')?.canonicalSession?.id).toBe('one');
    expect(resolveAssistantDraft(directory.assistants, 'second', null)?.canonicalSession?.id).toBe('two');
    expect(resolveAssistantDraft(directory.assistants, 'missing', null)).toBeNull();
    expect(resolveAssistantDraft(directory.assistants, 'first', '/other')).toBeNull();
  });
});
