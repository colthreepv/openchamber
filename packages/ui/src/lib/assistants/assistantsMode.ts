import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { isVSCodeRuntime } from '@/lib/desktop';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { getRuntimeKey, isTransientRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';

const prefix = 'openchamber.assistants.mode:';
const capability = 'ui.assistants.v1';
const responseSchema = z.object({ compatibility: z.object({ capabilities: z.array(z.string()) }).optional() });

export const resolveAssistantNavigation = (override: string | null, advertised: boolean | undefined): boolean =>
  override === 'on' ? true : override === 'off' ? false : advertised === true;

const storageKey = (key: string) => `${prefix}${encodeURIComponent(key)}`;
const readOverride = (key: string): string | null => {
  if (isTransientRuntimeKey(key)) return null;
  try { return localStorage.getItem(storageKey(key)); } catch { return null; }
};
const writeOverride = (key: string, value: string): void => {
  if (isTransientRuntimeKey(key)) return;
  try { localStorage.setItem(storageKey(key), value); } catch { /* Storage may be unavailable. */ }
};

const capabilities = new Map<string, boolean>();
const listeners = new Set<() => void>();
let generation = 0;
let started = false;
let queryApplied = false;
let transientOverride: { key: string; value: string } | null = null;
const notify = () => listeners.forEach((listener) => listener());
const snapshot = (): boolean => {
  if (isVSCodeRuntime()) return false;
  const key = getRuntimeKey();
  const override = transientOverride?.key === key ? transientOverride.value : readOverride(key);
  return resolveAssistantNavigation(override, capabilities.get(key));
};

const refresh = (): void => {
  const key = getRuntimeKey();
  const requestGeneration = ++generation;
  transientOverride = null;
  if (!queryApplied && !isTransientRuntimeKey(key)) {
    queryApplied = true;
    const value = new URLSearchParams(window.location.search).get('assistants');
    if (value === 'on' || value === 'off') {
      writeOverride(key, value);
      transientOverride = { key, value };
    }
  }
  notify();
  if (isTransientRuntimeKey(key) || isVSCodeRuntime()) return;
  void runtimeFetch('/api/version', { headers: { Accept: 'application/json' }, cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) return;
      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success || requestGeneration !== generation || getRuntimeKey() !== key) return;
      capabilities.set(key, parsed.data.compatibility?.capabilities.includes(capability) ?? false);
      notify();
    }).catch(() => { /* Keep the last successful result for this runtime. */ });
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const useAssistantNavigation = (): boolean => {
  const enabled = useSyncExternalStore(subscribe, snapshot, () => false);
  useEffect(() => {
    if (!started) {
      started = true;
      subscribeRuntimeEndpointChanged(refresh);
      refresh();
    }
  }, []);
  return enabled;
};
