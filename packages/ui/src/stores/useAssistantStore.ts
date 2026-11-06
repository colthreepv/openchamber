import React from 'react';

import { buildAssistantDirectory, type AssistantDirectory, type AssistantEntry } from '@/lib/assistants/assistantDirectory';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';

/**
 * Assistants fork: the assistants and their work sessions, derived from the
 * projects store and the cross-directory session list. Nothing is stored
 * twice: every field comes from a project or a session record
 * (`lib/assistants/assistantDirectory.ts`).
 */
export const useAssistantDirectory = (): AssistantDirectory => {
  const projects = useProjectsStore((state) => state.projects);
  const sessions = useGlobalSessionsStore((state) => state.activeSessions);
  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  return React.useMemo(
    () => buildAssistantDirectory(projects, sessions, homeDirectory),
    [projects, sessions, homeDirectory],
  );
};

/** The assistant a session belongs to (its canonical conversation or a work it started), if any. */
export const useAssistantForSession = (sessionId: string | null | undefined): { assistant: AssistantEntry; isCanonical: boolean } | null => {
  const directory = useAssistantDirectory();
  return React.useMemo(() => {
    if (!sessionId) return null;
    const owner = directory.ownerBySessionId.get(sessionId);
    const assistant = owner ? directory.assistants.find((entry) => entry.projectId === owner) : undefined;
    if (!assistant) return null;
    return { assistant, isCanonical: assistant.canonicalSession?.id === sessionId };
  }, [directory, sessionId]);
};
