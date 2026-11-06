import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import type { AssistantEntry } from './assistantDirectory';

const directory = '/home/me/assistants/alpha';
const assistant: AssistantEntry = {
  projectId: 'alpha', project: { id: 'alpha', path: directory }, name: 'Alpha', role: 'helper',
  color: null, directory, canonicalSession: null, workSessions: [], lastActivity: 0,
};
const canonical: Session = {
  id: 'existing', directory, projectID: 'alpha', title: 'Alpha', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1 },
  metadata: { openchamber: { assistant: { name: 'Alpha', role: 'helper', canonical: true } } },
};

type SessionSnapshot = { activeSessions: Session[]; hasLoaded: boolean; status: string };
let state: SessionSnapshot;
const refresh = mock(async () => {});
const runtimeFetch = mock(async () => new Response(JSON.stringify({ sessionId: 'created' })));
const closeSurfaces = mock(() => {});
const projectSelections: string[] = [];
const sessionSelections: Array<[string, string | null]> = [];
const setProject = mock((id: string) => { projectSelections.push(id); });
const setSession = mock(async (id: string, directory: string | null) => { sessionSelections.push([id, directory]); });

mock.module('@/lib/opencode/client', () => ({ opencodeClient: {} }));
mock.module('@/lib/runtime-fetch', () => ({ runtimeFetch }));
mock.module('@/lib/runtime-switch', () => ({ captureRuntimeInstance: () => () => true, getRuntimeKey: () => 'test' }));
mock.module('@/stores/useGlobalSessionsStore', () => ({ refreshGlobalSessions: refresh, useGlobalSessionsStore: { getState: () => state } }));
mock.module('@/stores/useDirectoryStore', () => ({ useDirectoryStore: { getState: () => ({}) } }));
mock.module('@/stores/useProjectsStore', () => ({ useProjectsStore: { getState: () => ({ setActiveProjectIdOnly: setProject }) } }));
mock.module('@/stores/useUIStore', () => ({ useUIStore: { getState: () => ({ closeMainSurfaces: closeSurfaces }) } }));
mock.module('@/sync/session-ui-store', () => ({ useSessionUIStore: { getState: () => ({ setCurrentSession: setSession }) } }));
mock.module('@/sync/session-archive-batch', () => ({ requestSessionMetadataUpdate: mock(async () => ({ outcome: 'updated' })) }));
mock.module('@/sync/session-admission', () => ({ admitSession: mock(async () => true) }));
mock.module('@/lib/persistence', () => ({ updateDesktopSettings: mock(async () => ({ ok: true })) }));

const { openAssistant } = await import('./assistantActions');

beforeEach(() => {
  state = { activeSessions: [], hasLoaded: false, status: 'loading' };
  refresh.mockReset();
  runtimeFetch.mockReset();
  closeSurfaces.mockReset();
  setProject.mockReset();
  setSession.mockReset();
  projectSelections.length = 0;
  sessionSelections.length = 0;
  setProject.mockImplementation((id) => { projectSelections.push(id); });
  setSession.mockImplementation(async (id, directory) => { sessionSelections.push([id, directory]); });
});

describe('openAssistant', () => {
  test('waits for the authoritative snapshot and opens the canonical session it finds', async () => {
    let complete!: () => void;
    refresh.mockImplementation(() => new Promise<void>((resolve) => { complete = resolve; }));
    const opening = openAssistant(assistant);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();

    state = { activeSessions: [canonical], hasLoaded: true, status: 'ready' };
    complete();
    await opening;
    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(closeSurfaces).toHaveBeenCalledTimes(1);
    expect(projectSelections).toEqual(['alpha']);
    expect(sessionSelections).toEqual([['existing', directory]]);
  });

  for (const result of [{ hasLoaded: false, status: 'ready' }, { hasLoaded: true, status: 'error' }]) {
    test(`does not create or navigate after ${result.status}, loaded=${result.hasLoaded}`, async () => {
      refresh.mockImplementation(async () => { state = { activeSessions: [], ...result }; });
      let message = '';
      try { await openAssistant(assistant); } catch (error) { message = error instanceof Error ? error.message : String(error); }
      expect(message.includes('Could not load the assistant conversation')).toBe(true);
      expect(runtimeFetch).not.toHaveBeenCalled();
      expect(closeSurfaces).not.toHaveBeenCalled();
      expect(setProject).not.toHaveBeenCalled();
      expect(setSession).not.toHaveBeenCalled();
    });
  }
});
