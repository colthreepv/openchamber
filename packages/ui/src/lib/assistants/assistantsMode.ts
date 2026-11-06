import { create } from 'zustand';

/**
 * Assistants fork: the switch between the assistant sidebar and the stock
 * project sidebar. Local to the browser (localStorage), never a settings.json
 * key, so the stock settings registry stays untouched. On by default in this
 * fork. `?assistants=off` / `?assistants=on` in the URL flips and persists it,
 * which is the way back when the stock sidebar has no switch.
 */

const STORAGE_KEY = 'openchamber.assistants.mode';

const readInitial = (): boolean => {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('assistants');
    if (fromQuery === 'on' || fromQuery === 'off') {
      window.localStorage.setItem(STORAGE_KEY, fromQuery);
      return fromQuery === 'on';
    }
    return window.localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
};

type AssistantsModeState = {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
};

export const useAssistantsMode = create<AssistantsModeState>((set) => ({
  enabled: readInitial(),
  setEnabled: (enabled) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      // Private mode: the switch still holds for this page.
    }
    set({ enabled });
  },
}));
