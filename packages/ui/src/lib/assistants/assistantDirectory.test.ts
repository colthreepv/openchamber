import { describe, expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import { projectSession } from '@/lib/opencode/projection';
import { buildAssistantDirectory } from './assistantDirectory';

const projects = [
  { id: 'a', path: '/home/me/assistants/alpha', label: 'Alpha', color: '#123456' },
  { id: 'b', path: '/elsewhere/beta' },
  { id: 'missing', path: '/home/me/assistants/missing' },
  { id: 'ordinary', path: '/home/me/ordinary' },
];
const session = (id: string, directory: string, options: {
  canonical?: boolean; startedBy?: string; parentID?: string; archived?: number; created?: number; updated?: number;
} = {}): Session => ({
  id, directory, projectID: 'project', title: id, cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: options.created ?? 1, updated: options.updated ?? 1, archived: options.archived },
  parentID: options.parentID,
  metadata: { openchamber: {
    assistant: options.canonical ? { name: `Name ${id}`, role: 'helper', canonical: true, version: 1 } : null,
    startedBy: options.startedBy ? { sessionID: options.startedBy } : null,
  } },
});
const a = '/home/me/assistants/alpha';
const b = '/elsewhere/beta';
const ids = (items: { session: Session }[]) => items.map(({ session: item }) => item.id);

describe('buildAssistantDirectory', () => {
  test('groups roots by canonical marker and cross-directory chain before directory fallback', () => {
    const result = buildAssistantDirectory(projects, [
      session('ca', a, { canonical: true, startedBy: 'cb', updated: 2 }),
      session('cb', b, { canonical: true, updated: 3 }),
      session('direct', '/other', { startedBy: 'ca', updated: 5 }),
      session('chain', b, { startedBy: 'direct', updated: 7 }),
      session('local', a, { updated: 4 }),
      session('fallback', '/home/me/assistants/missing', { updated: 6 }),
      session('other', '/other', { updated: 8 }),
      session('child', a, { parentID: 'ca', updated: 20 }),
      session('archived', a, { archived: 9, updated: 30 }),
      session('archived-zero', a, { archived: 0, updated: 31 }),
    ], '/home/me');
    const alpha = result.assistants.find((item) => item.projectId === 'a')!;
    expect(alpha.canonicalSession?.id).toBe('ca');
    expect([alpha.name, alpha.role, alpha.color, alpha.lastActivity]).toEqual(['Alpha', 'helper', '#123456', 7]);
    expect(ids(alpha.workSessions)).toEqual(['chain', 'direct', 'local']);
    expect(alpha.workSessions[0]).toMatchObject({ directory: b, directoryName: 'beta' });
    expect(ids(result.assistants.find((item) => item.projectId === 'missing')!.workSessions)).toEqual(['fallback']);
    expect(result.assistants.find((item) => item.projectId === 'missing')!.canonicalSession).toBeNull();
    expect(ids(result.otherSessions)).toEqual(['other']);
    expect(Object.fromEntries(result.ownerBySessionId)).toEqual({ ca: 'a', cb: 'b', direct: 'a', chain: 'a', local: 'a', fallback: 'missing' });
  });

  test('cycles, missing or archived starters do not invent ownership; parent sessions are not listed', () => {
    const result = buildAssistantDirectory(projects, [
      session('ca', a, { canonical: true }),
      session('dead', '/other', { startedBy: 'ca', archived: 2 }),
      session('via-dead', '/other', { startedBy: 'dead' }),
      session('cycle1', '/other', { startedBy: 'cycle2' }),
      session('cycle2', '/other', { startedBy: 'cycle1' }),
      session('local-cycle', a, { startedBy: 'local-cycle' }),
      session('child', '/other', { parentID: 'ca', startedBy: 'ca' }),
      session('orphan', '/other', { startedBy: 'absent' }),
    ], '/home/me');
    expect(new Set(ids(result.otherSessions))).toEqual(new Set(['via-dead', 'cycle1', 'cycle2', 'orphan']));
    expect(ids(result.assistants.find((item) => item.projectId === 'a')!.workSessions)).toEqual(['local-cycle']);
    expect(result.ownerBySessionId.has('child')).toBe(false);
  });

  test('duplicate canonical markers have a stable identity independent of updates and input order', () => {
    const old = session('old', a, { canonical: true, created: 1, updated: 1 });
    const newer = session('new', a, { canonical: true, startedBy: 'cb', created: 2, updated: 99 });
    const beta = session('cb', b, { canonical: true });
    const delegated = session('delegated', '/other', { startedBy: 'new' });
    for (const list of [[old, newer, beta, delegated], [delegated, beta, newer, { ...old, time: { ...old.time, updated: 100 } }]]) {
      const result = buildAssistantDirectory(projects, list, '/home/me');
      const alpha = result.assistants.find((item) => item.projectId === 'a')!;
      expect(alpha.canonicalSession?.id).toBe('old');
      expect(result.ownerBySessionId.get('delegated')).toBe('a');
      expect(result.ownerBySessionId.get('new')).toBe('a');
      expect(ids(alpha.workSessions).filter((id) => id === 'new')).toHaveLength(1);
    }
  });

  test('uses projected OpenCode metadata and breaks equal creation times by ID', () => {
    const makeProjected = (id: string) => projectSession({
      id, projectID: 'project', location: { directory: a }, title: id, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 2 },
      metadata: { openchamber: { assistant: { name: id, role: 'helper', canonical: true } } },
    });
    const result = buildAssistantDirectory(projects, [makeProjected('z'), makeProjected('a')], '/home/me');
    const alpha = result.assistants.find((item) => item.projectId === 'a')!;
    expect(alpha.canonicalSession?.id).toBe('a');
    expect(ids(alpha.workSessions)).toEqual(['z']);
  });
});
