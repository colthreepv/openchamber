import { opencodeClient } from '@/lib/opencode/client';
import { parseModelSelection } from '@/lib/modelIdentifier';
import type { Session } from '@/lib/opencode/model';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { captureRuntimeInstance, getRuntimeKey } from '@/lib/runtime-switch';
import { z } from 'zod';
import { refreshGlobalSessions, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { requestSessionMetadataUpdate } from '@/sync/session-archive-batch';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { admitSession } from '@/sync/session-admission';
import { updateDesktopSettings } from '@/lib/persistence';

import type { AssistantEntry } from './assistantDirectory';
import {
  buildAssistantMarkerPatch,
  DEFAULT_ASSISTANT_AGENTS_MD,
  getAssistantsRoot,
  isCanonicalAssistantSession,
  slugifyAssistantName,
} from './assistantMetadata';

/**
 * Assistants fork: what the assistant sidebar does. Every step goes through
 * routes the stock server already serves: `/api/openchamber/directory`
 * (create + register the workspace), `/api/fs/upload` (the AGENTS.md
 * micro-prompt), the projects store (label, colour, model, face), and
 * `/api/openchamber/sessions` (the canonical conversation and its marker).
 */

export const openSessionInChat = (sessionId: string, directory: string | null, projectId: string | null): void => {
  // Selecting a session always leaves a full-page surface, as the stock rows do.
  useUIStore.getState().closeMainSurfaces();
  if (projectId) useProjectsStore.getState().setActiveProjectIdOnly(projectId);
  void useSessionUIStore.getState().setCurrentSession(sessionId, directory || null);
};

export const openWorkSession = async (session: Session): Promise<boolean> => {
  const isCurrent = captureRuntimeInstance();
  if (!await admitSession(session.id, session.directory, true) || !isCurrent()) return false;
  const project = useProjectsStore.getState().projects.find((entry) => entry.path === session.directory) ?? null;
  openSessionInChat(session.id, session.directory, project?.id ?? null);
  return true;
};

const createSessionRecord = async (directory: string, title: string): Promise<string> => {
  const response = await runtimeFetch('/api/openchamber/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ directory, title }),
  });
  const body: unknown = await response.json().catch(() => null);
  const parsed = z.object({ sessionId: z.string().min(1) }).safeParse(body);
  if (!response.ok || !parsed.success) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.error : `session create failed with ${response.status}`);
  }
  return parsed.data.sessionId;
};

type CanonicalOperation = { isCurrent: () => boolean; sessionId?: string; marked?: boolean; promise?: Promise<string> };
const canonicalOperations = new Map<string, CanonicalOperation>();
const ensureCurrent = (isCurrent: () => boolean): void => {
  if (!isCurrent()) throw new Error('Runtime changed during assistant operation');
};

/** Creates the canonical conversation of an assistant in its folder and marks it. */
const createCanonicalSession = (directory: string, name: string, role: string, model: string | undefined, isCurrent: () => boolean): Promise<string> => {
  const key = `${getRuntimeKey()}\n${directory}`;
  const previous = canonicalOperations.get(key);
  const entry: CanonicalOperation = previous?.isCurrent() ? previous : { isCurrent };
  canonicalOperations.set(key, entry);
  if (entry.promise) return entry.promise;
  const operation = (async () => {
    if (!entry.sessionId) {
      entry.sessionId = await createSessionRecord(directory, name);
      if (!isCurrent()) throw new Error(`Runtime changed after creating session ${entry.sessionId} in ${directory}; inspect that session on the original runtime`);
    }
    const sessionId = entry.sessionId;
    if (!entry.marked) {
      const marked = await requestSessionMetadataUpdate(sessionId, buildAssistantMarkerPatch(name, role), directory);
      ensureCurrent(isCurrent);
      if (marked.outcome !== 'updated') throw new Error(`assistant marker not stored for session ${sessionId}: ${marked.reason}; retry opening the assistant`);
      entry.marked = true;
    }
    const selection = model ? parseModelSelection(model) : null;
    if (model && !selection) throw new Error(`Invalid assistant model: ${model}`);
    if (selection) {
      await opencodeClient.switchSessionModel(sessionId, {
        providerID: selection.providerID,
        id: selection.modelID,
        variant: selection.variant,
      }, directory);
      ensureCurrent(isCurrent);
    }
    return sessionId;
  })();
  entry.promise = operation;
  void operation.finally(() => { if (entry.promise === operation) entry.promise = undefined; }).catch(() => {});
  return operation;
};

/** Opens an assistant's conversation, creating it again when it is missing. */
export const openAssistant = async (assistant: AssistantEntry): Promise<void> => {
  const isCurrent = captureRuntimeInstance();
  const findCanonical = () => useGlobalSessionsStore.getState().activeSessions.find(
    (session) => session.directory === assistant.directory && !session.parentID && isCanonicalAssistantSession(session),
  );
  let canonical = findCanonical();
  if (!canonical) {
    // Cached or partial pages cannot prove the long-lived conversation is gone.
    await refreshGlobalSessions();
    ensureCurrent(isCurrent);
    const state = useGlobalSessionsStore.getState();
    if (!state.hasLoaded || state.status !== 'ready') throw new Error('Could not load the assistant conversation; retry opening it');
    canonical = findCanonical();
  }
  if (canonical) {
    openSessionInChat(canonical.id, assistant.directory, assistant.projectId);
    return;
  }
  const sessionId = await createCanonicalSession(assistant.directory, assistant.name, assistant.role, assistant.project.defaultModel, isCurrent);
  ensureCurrent(isCurrent);
  await refreshGlobalSessions();
  ensureCurrent(isCurrent);
  if (useGlobalSessionsStore.getState().activeSessions.some((session) => session.id === sessionId)) {
    canonicalOperations.delete(`${getRuntimeKey()}\n${assistant.directory}`);
  }
  openSessionInChat(sessionId, assistant.directory, assistant.projectId);
};

type CreateAssistantInput = {
  name: string;
  role: string;
  color: string | null;
  /** `provider/model`, or empty for the server default. */
  defaultModel: string;
  avatar: File | null;
};

type CreateAssistantResult = { projectId: string; sessionId: string; directory: string; warnings: string[] };

export const createAssistant = async (input: CreateAssistantInput): Promise<CreateAssistantResult> => {
  const isCurrent = captureRuntimeInstance();
  const name = input.name.trim();
  const role = input.role.trim();
  const slug = slugifyAssistantName(name);
  if (!name || !slug) throw new Error('A name with letters or digits is required');
  const root = getAssistantsRoot(useDirectoryStore.getState().homeDirectory);
  if (!root) throw new Error('The server home directory is not known yet');
  const directory = `${root}/${slug}`;
  const projects = useProjectsStore.getState();
  if (projects.projects.some((project) => project.path === directory)) {
    throw new Error(`An assistant already lives in ${directory}; open it from the assistant sidebar to resume`);
  }

  // Creates the folder and registers it as a project on the server.
  const created = await opencodeClient.createDirectory(directory, { asProject: true });
  ensureCurrent(isCurrent);
  if (!created.success) throw new Error(`Could not create ${directory}`);
  const project = await projects.addProject(directory, { label: name });
  ensureCurrent(isCurrent);
  if (!project) throw new Error(`Could not register ${directory}`);

  const warnings: string[] = [];
  // Upload without overwrite: createDirectory also succeeds for existing folders.
  const agentsResponse = await runtimeFetch('/api/fs/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    query: { path: `${directory}/AGENTS.md` },
    body: DEFAULT_ASSISTANT_AGENTS_MD(name, role),
    directory,
  });
  ensureCurrent(isCurrent);
  if (agentsResponse.status === 409) warnings.push('Existing AGENTS.md was preserved');
  else if (!agentsResponse.ok) warnings.push(`AGENTS.md was not written (${agentsResponse.status})`);

  useProjectsStore.getState().updateProjectMeta(project.id, {
    label: name,
    color: input.color,
    iconBackground: input.color,
    defaultModel: input.defaultModel || undefined,
  });
  // The icon endpoint saves the registry too. Finish the queued identity write
  // first, or its older project snapshot can erase the uploaded image.
  const identity = useProjectsStore.getState();
  const saved = await updateDesktopSettings({ projects: identity.projects });
  ensureCurrent(isCurrent);
  if (!saved.ok) throw new Error(`Could not save assistant identity in ${directory}; reopen it from the sidebar`);
  if (input.avatar) {
    const uploaded = await useProjectsStore.getState().uploadProjectIcon(project.id, input.avatar);
    ensureCurrent(isCurrent);
    if (!uploaded.ok) warnings.push(`Avatar upload failed: ${uploaded.error ?? 'unknown error'}`);
  }

  const sessionId = await createCanonicalSession(directory, name, role, input.defaultModel || undefined, isCurrent);
  ensureCurrent(isCurrent);
  await refreshGlobalSessions();
  ensureCurrent(isCurrent);
  if (useGlobalSessionsStore.getState().activeSessions.some((session) => session.id === sessionId)) {
    canonicalOperations.delete(`${getRuntimeKey()}\n${directory}`);
  }
  openSessionInChat(sessionId, directory, project.id);
  return { projectId: project.id, sessionId, directory, warnings };
};
