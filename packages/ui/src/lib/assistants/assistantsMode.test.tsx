import { describe, expect, test } from 'bun:test';
import { resolveAssistantNavigation } from './assistantsMode';

describe('assistant navigation resolution', () => {
  test('overrides take precedence over server capability', () => {
    for (const capability of [true, false, undefined]) {
      expect(resolveAssistantNavigation('on', capability)).toBe(true);
      expect(resolveAssistantNavigation('off', capability)).toBe(false);
    }
    expect(resolveAssistantNavigation(null, true)).toBe(true);
    expect(resolveAssistantNavigation(null, false)).toBe(false);
    expect(resolveAssistantNavigation(null, undefined)).toBe(false);
    expect(resolveAssistantNavigation('invalid', true)).toBe(true);
  });
});

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { spyOn } from 'bun:test';
import { installHookTestDom } from '@/components/session/sidebar/test-utils/testDom';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';
import { useAssistantNavigation } from './assistantsMode';

test('switches runtime immediately, preserves cached capability on failure, and rejects stale responses', async () => {
  const dom = installHookTestDom();
  Object.defineProperty(window, 'location', { configurable: true, value: { search: '' } });
  const root = createRoot(dom.container);
  let release: (response: Response) => void = () => {};
  let mode: 'fork' | 'stock' | 'failure' | 'pending' = 'fork';
  const network = spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    if (!String(input).includes('/api/version')) return Response.json({});
    if (mode === 'failure') throw new Error('offline');
    if (mode === 'pending') return new Promise<Response>((resolve) => { release = resolve; });
    return Response.json({ compatibility: { capabilities: mode === 'fork' ? ['ui.assistants.v1'] : [] } });
  });
  let visible = false;
  const Readout = () => { visible = useAssistantNavigation(); return null; };
  const switchTo = (key: string) => switchRuntimeEndpoint({ apiBaseUrl: `https://${key}.example`, runtimeKey: key });
  try {
    switchTo('fork');
    await act(async () => { root.render(<Readout />); });
    expect(visible).toBe(true);
    mode = 'stock';
    await act(async () => { switchTo('stock'); });
    expect(visible).toBe(false);
    mode = 'failure';
    await act(async () => { switchTo('fork'); });
    expect(visible).toBe(true);
    mode = 'pending';
    await act(async () => { switchTo('fork'); });
    mode = 'stock';
    await act(async () => { switchTo('stock'); });
    await act(async () => { release(Response.json({ compatibility: { capabilities: ['ui.assistants.v1'] } })); });
    expect(visible).toBe(false);
  } finally {
    await act(async () => root.unmount());
    network.mockRestore();
    dom.restore();
  }
});
