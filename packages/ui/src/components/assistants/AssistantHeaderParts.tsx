import React from 'react';

import { openSessionInChat } from '@/lib/assistants/assistantActions';
import { useI18n } from '@/lib/i18n';
import { useAssistantNavigation } from '@/lib/assistants/assistantsMode';
import { useAssistantForSession } from '@/stores/useAssistantStore';

import { AssistantAvatar } from './AssistantAvatar';

/**
 * Assistants fork: the chat header's assistant identity.
 *
 * - In an assistant's own conversation the title becomes its face, name and
 *   role (`AssistantHeaderLabel`).
 * - In a work session an assistant started, a small face before the title
 *   links back to that assistant's conversation (`AssistantHeaderBadge`), and
 *   the title gains a "by <name>" line.
 *
 * Both render nothing with the assistants mode off or outside assistants.
 */

export const AssistantHeaderBadge: React.FC<{ sessionId: string | null | undefined; size?: number }> = ({ sessionId, size = 28 }) => {
  const { t } = useI18n();
  const enabled = useAssistantNavigation();
  const owner = useAssistantForSession(enabled ? sessionId : null);
  if (!owner || owner.isCanonical) return null;
  const { assistant } = owner;
  const canonicalId = assistant.canonicalSession?.id;
  return (
    <button
      type="button"
      className="flex shrink-0 items-center justify-center rounded-full p-1 transition-colors hover:bg-interactive-hover disabled:opacity-60"
      aria-label={t('assistants.backTo', { name: assistant.name })}
      title={t('assistants.startedBy', { name: assistant.name })}
      disabled={!canonicalId}
      onClick={() => {
        if (canonicalId) openSessionInChat(canonicalId, assistant.directory, assistant.projectId);
      }}
      style={{ touchAction: 'manipulation' }}
    >
      <AssistantAvatar project={assistant.project} name={assistant.name} size={size} />
    </button>
  );
};

export const AssistantHeaderLabel: React.FC<{
  sessionId: string | null | undefined;
  title: string;
  fallback: React.ReactNode;
}> = ({ sessionId, title, fallback }) => {
  const { t } = useI18n();
  const enabled = useAssistantNavigation();
  const owner = useAssistantForSession(enabled ? sessionId : null);
  if (!owner) return <>{fallback}</>;
  const { assistant, isCanonical } = owner;
  if (isCanonical) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <AssistantAvatar project={assistant.project} name={assistant.name} size={32} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span dir="auto" className="truncate typography-ui-label font-semibold text-foreground">{assistant.name}</span>
          {assistant.role ? <span dir="auto" className="truncate typography-micro text-muted-foreground">{assistant.role}</span> : null}
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span dir="auto" className="truncate typography-ui-label text-foreground">{title}</span>
      <span className="truncate typography-micro text-muted-foreground">{t('assistants.by', { name: assistant.name })}</span>
    </span>
  );
};
