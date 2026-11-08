import React from 'react';
import { useAssistantNavigation } from './assistantsMode';
import { readLastAssistant, rememberAssistant, resolveAssistantDraft, resolveLandingAssistant } from './assistantLanding';
import { openSessionInChat } from './assistantActions';
import { useAssistantDirectory } from '@/stores/useAssistantStore';
import { refreshGlobalSessions, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';

/** Mounted once by the main chat; never changes a routed or pinned conversation. */
export function useAssistantLanding(active: boolean): void {
  const enabled = useAssistantNavigation();
  const directory = useAssistantDirectory();
  const ready = useGlobalSessionsStore((state) => state.hasLoaded && state.status === 'ready');
  const projects = useProjectsStore((state) => state.projects);
  const activeProject = useProjectsStore((state) => state.activeProjectId);
  const sessionId = useSessionUIStore((state) => state.currentSessionId);
  const draft = useSessionUIStore((state) => state.newSessionDraft);
  const initial = React.useRef({ pending: true, explicit: new URLSearchParams(window.location.search).has('session'), sessionId });

  React.useEffect(() => {
    if (active && enabled && !useGlobalSessionsStore.getState().hasLoaded) void refreshGlobalSessions();
  }, [active, enabled]);

  React.useEffect(() => {
    if (!active || !enabled || !ready) return;
    if (initial.current.pending) {
      // Route application can still be admitting the linked session.
      if (initial.current.explicit && !sessionId) return;
      initial.current.pending = false;
      if (!initial.current.explicit && sessionId === initial.current.sessionId) {
        const assistant = resolveLandingAssistant(directory.assistants, projects.map((project) => project.id), readLastAssistant());
        if (assistant?.canonicalSession) {
          rememberAssistant(assistant.projectId);
          openSessionInChat(assistant.canonicalSession.id, assistant.directory, assistant.projectId);
          return;
        }
      }
    }
    if (sessionId) {
      const owner = directory.assistants.find((item) => item.canonicalSession?.id === sessionId);
      if (owner) rememberAssistant(owner.projectId);
      return;
    }
    if (!draft.open || draft.target !== 'project') return;
    const assistant = resolveAssistantDraft(directory.assistants, draft.selectedProjectId ?? activeProject, draft.directoryOverride);
    if (assistant?.canonicalSession) {
      rememberAssistant(assistant.projectId);
      openSessionInChat(assistant.canonicalSession.id, assistant.directory, assistant.projectId);
    }
  }, [active, enabled, ready, directory, projects, activeProject, sessionId, draft]);
}
