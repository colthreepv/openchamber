import React from 'react';
import type { AssistantEntry } from '@/lib/assistants/assistantDirectory';
import { useI18n } from '@/lib/i18n';
import { useInputStore } from '@/sync/input-store';
import { Button } from '@/components/ui/button';
import { AssistantAvatar } from './AssistantAvatar';

export const AssistantWelcome: React.FC<{ assistant: AssistantEntry }> = ({ assistant }) => {
  const { t } = useI18n();
  const starters = [t('assistants.starterToday'), t('assistants.starterRemind'), t('assistants.starterContinue')];
  return <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
    <AssistantAvatar project={assistant.project} name={assistant.name} size={80} />
    <h1 dir="auto" className="mt-4 text-3xl font-normal tracking-tight text-foreground">{assistant.name}</h1>
    {assistant.role && <p dir="auto" className="mt-2 typography-ui-label text-muted-foreground">{assistant.role}</p>}
    <div className="mt-8 flex max-w-md flex-wrap justify-center gap-2">
      {starters.map((text) => <Button key={text} type="button" variant="chip" onClick={() => useInputStore.getState().setPendingInputText(text, 'replace')}>{text}</Button>)}
    </div>
  </div>;
};
