import type { AssistantEntry } from './assistantDirectory';
import { getRuntimeKey, isTransientRuntimeKey } from '@/lib/runtime-switch';

const prefix = 'openchamber.assistants.last:';
const lastAssistantKey = (runtime: string) => `${prefix}${encodeURIComponent(runtime)}`;
export const readLastAssistant = (runtime = getRuntimeKey()): string | null => {
  if (isTransientRuntimeKey(runtime)) return null;
  try { return localStorage.getItem(lastAssistantKey(runtime)); } catch { return null; }
};
export const rememberAssistant = (projectId: string, runtime = getRuntimeKey()): void => {
  if (isTransientRuntimeKey(runtime)) return;
  try { localStorage.setItem(lastAssistantKey(runtime), projectId); } catch { /* Storage may be unavailable. */ }
};

/** Project registry order is stable; activity-sorted sidebar order is not. */
export function resolveLandingAssistant(assistants: readonly AssistantEntry[], projectOrder: readonly string[], last: string | null): AssistantEntry | null {
  return assistants.find((item) => item.projectId === last)
    ?? projectOrder.map((id) => assistants.find((item) => item.projectId === id)).find(Boolean)
    ?? assistants[0] ?? null;
}

export function resolveAssistantDraft(assistants: readonly AssistantEntry[], projectId: string | null | undefined, directory: string | null | undefined): AssistantEntry | null {
  const normalize = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '');
  const assistant = assistants.find((item) => directory ? normalize(item.directory) === normalize(directory) : item.projectId === projectId);
  return assistant?.canonicalSession ? assistant : null;
}
