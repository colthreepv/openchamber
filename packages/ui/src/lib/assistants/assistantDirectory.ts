import type { ProjectEntry } from '@/lib/api/types';
import type { Session } from '@/lib/opencode/model';

import {
  basenameOf,
  isAssistantWorkspacePath,
  readAssistantMarker,
  readStartedBySessionId,
} from './assistantMetadata';

/**
 * Assistants fork: the sidebar's model, derived from projects and sessions.
 *
 * An assistant is a project with a canonical session marked
 * `openchamber.assistant.canonical` in its directory. A project under
 * `<home>/assistants/` with no canonical session (deleted, not created yet) is
 * still an assistant; opening it creates the conversation again.
 *
 * A work session belongs to the assistant whose canonical session started it
 * (`openchamber.startedBy`), following the chain through work sessions that
 * started others, in any folder. Other non-canonical sessions in the
 * assistant's own folder belong to it too. Subagent runs (`parentID`) are not
 * listed: they belong to the session that ran them.
 */

export type AssistantWorkSession = {
  session: Session;
  directory: string;
  directoryName: string;
};

export type AssistantEntry = {
  projectId: string;
  project: ProjectEntry;
  name: string;
  role: string;
  color: string | null;
  directory: string;
  canonicalSession: Session | null;
  workSessions: AssistantWorkSession[];
  /** Newest `time.updated` over the canonical and work sessions, 0 without any. */
  lastActivity: number;
};

export type AssistantDirectory = {
  assistants: AssistantEntry[];
  /** Root sessions owned by no assistant, newest first. */
  otherSessions: AssistantWorkSession[];
  /** Session id → the assistant that owns it (canonical or work). */
  ownerBySessionId: Map<string, string>;
};

const normalizeDirectory = (value: string | null | undefined): string => {
  if (!value) return '';
  const normalized = value.replace(/\\/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/+$/, '') : normalized;
};

const toWork = (session: Session): AssistantWorkSession => {
  const directory = normalizeDirectory(session.directory);
  return { session, directory, directoryName: basenameOf(directory) };
};

const updatedAt = (session: Session): number => session.time?.updated ?? session.time?.created ?? 0;

export const buildAssistantDirectory = (
  projects: readonly ProjectEntry[],
  sessions: readonly Session[],
  homeDirectory: string | null | undefined,
): AssistantDirectory => {
  const live = sessions.filter((session) => session.time?.archived == null);
  const byId = new Map(live.map((session) => [session.id, session]));
  const projectByPath = new Map(projects.map((project) => [normalizeDirectory(project.path), project]));

  // In a folder with duplicate markers, keep the oldest identity stable as
  // activity changes; use the ID to break ties in creation time.
  const canonicalByProjectId = new Map<string, Session>();
  const projectIdByCanonicalId = new Map<string, string>();
  for (const session of live) {
    if (session.parentID) continue;
    const marker = readAssistantMarker(session);
    if (!marker?.canonical) continue;
    const project = projectByPath.get(normalizeDirectory(session.directory));
    if (!project) continue;
    projectIdByCanonicalId.set(session.id, project.id);
    const current = canonicalByProjectId.get(project.id);
    if (!current || session.time.created < current.time.created
      || (session.time.created === current.time.created && session.id < current.id)) {
      canonicalByProjectId.set(project.id, session);
    }
  }

  const assistants: AssistantEntry[] = [];
  const selectedCanonicalIds = new Set<string>();
  const projectIdByDirectory = new Map<string, string>();
  for (const project of projects) {
    const canonical = canonicalByProjectId.get(project.id) ?? null;
    if (!canonical && !isAssistantWorkspacePath(project.path, homeDirectory)) continue;
    const marker = readAssistantMarker(canonical);
    const directory = normalizeDirectory(project.path);
    assistants.push({
      projectId: project.id,
      project,
      name: project.label?.trim() || marker?.name || basenameOf(directory),
      role: marker?.role ?? '',
      color: project.color ?? null,
      directory,
      canonicalSession: canonical,
      workSessions: [],
      lastActivity: canonical ? updatedAt(canonical) : 0,
    });
    if (canonical) selectedCanonicalIds.add(canonical.id);
    projectIdByDirectory.set(directory, project.id);
  }

  const ownerBySessionId = new Map<string, string>();
  for (const [sessionId, projectId] of projectIdByCanonicalId) ownerBySessionId.set(sessionId, projectId);

  // Follows startedBy up to a canonical session. Loops are refused.
  const resolveOwner = (session: Session): string | null => {
    const seen = new Set<string>([session.id]);
    let starterId = readStartedBySessionId(session);
    while (starterId && !seen.has(starterId)) {
      seen.add(starterId);
      const owner = projectIdByCanonicalId.get(starterId);
      if (owner) return owner;
      const starter = byId.get(starterId);
      if (!starter) return null;
      starterId = readStartedBySessionId(starter);
    }
    return null;
  };

  const entryById = new Map(assistants.map((entry) => [entry.projectId, entry]));
  const otherSessions: AssistantWorkSession[] = [];
  for (const session of live) {
    if (session.parentID || selectedCanonicalIds.has(session.id)) continue;
    const owner = projectIdByCanonicalId.get(session.id) ?? resolveOwner(session) ?? projectIdByDirectory.get(normalizeDirectory(session.directory)) ?? null;
    const entry = owner ? entryById.get(owner) : undefined;
    if (entry) {
      entry.workSessions.push(toWork(session));
      entry.lastActivity = Math.max(entry.lastActivity, updatedAt(session));
      ownerBySessionId.set(session.id, entry.projectId);
    } else {
      otherSessions.push(toWork(session));
    }
  }

  const byNewest = (left: AssistantWorkSession, right: AssistantWorkSession) => updatedAt(right.session) - updatedAt(left.session);
  for (const entry of assistants) entry.workSessions.sort(byNewest);
  otherSessions.sort(byNewest);
  assistants.sort((left, right) => right.lastActivity - left.lastActivity || left.name.localeCompare(right.name));

  return { assistants, otherSessions, ownerBySessionId };
};
