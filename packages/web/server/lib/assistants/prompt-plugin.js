const PLUGIN_ID = 'openchamber-assistant-prompt';

// Import-free: the child cannot load dependencies from Electron's app.asar.
const setupAssistantPrompt = async (ctx, template) => {
  // Native String.valueOf brand-checks without coercing JSON numbers/objects.
  const parseText = (value) => {
    try { return String.prototype.valueOf.call(value).trim(); } catch { return null; }
  };
  const sessions = new Map();
  const directories = new Map();
  const controller = new AbortController();
  let cacheAvailable = true;
  let revision = 0;
  const invalidate = () => { revision += 1; sessions.clear(); directories.clear(); };
  // Only identity-changing events invalidate the lookup. Ordinary message and
  // usage events must not turn every model step into another paginated list.
  const changes = ctx.event.subscribe({
    types: ['session.created', 'session.metadata.updated', 'session.moved', 'session.deleted', 'session.archived', 'session.unarchived'],
    signal: controller.signal,
  });
  const watcher = (async () => {
    try {
      for await (const _event of changes) invalidate();
    } finally {
      cacheAvailable = false;
      invalidate();
    }
  })().catch(() => {});

  const cached = async (cache, key, read) => {
    if (!cacheAvailable) return read();
    if (cache.has(key)) return cache.get(key);
    // These entries retain session records, not history. Bound a long-lived
    // location even when it sees many unrelated sessions without mutations.
    if (cache.size >= 256) cache.clear();
    const pending = read();
    cache.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      if (cache.get(key) === pending) cache.delete(key);
      throw error;
    }
  };
  const marker = (session) => {
    if (session.parentID || session.time.archived != null || session.metadata?.openchamber?.startedBy?.sessionID) return null;
    const value = session.metadata?.openchamber?.assistant ?? session.metadata?.assistant;
    const name = parseText(value?.name);
    if (value?.canonical !== true || !name) return null;
    return { name, role: parseText(value.role) ?? '' };
  };
  const canonicalIn = (directory) => cached(directories, directory, async () => {
    let oldest;
    let cursor;
    do {
      const page = await ctx.session.list({ directory, archived: false, limit: 100, cursor });
      for (const session of page.data) {
        if (!marker(session)) continue;
        if (!oldest || session.time.created < oldest.time.created
          || (session.time.created === oldest.time.created && session.id < oldest.id)) oldest = session;
      }
      cursor = page.cursor.next;
    } while (cursor);
    return oldest?.id;
  });
  await ctx.session.hook('context', async (event) => {
    let identity;
    while (true) {
      const before = revision;
      const session = await cached(sessions, event.sessionID, () => ctx.session.get({ sessionID: event.sessionID }));
      identity = marker(session);
      const canonical = identity && await canonicalIn(session.location.directory) === session.id;
      // A metadata write or archive during either read makes both obsolete.
      if (before !== revision) continue;
      if (!canonical) return;
      break;
    }
    // A stable system prefix, before directory instructions and history. Never
    // add timestamps, session lists or a synthetic message to this block.
    const values = { name: identity.name, role: identity.role ? `, ${identity.role}` : '' };
    const text = template.replace(/\{(name|role)\}/g, (_, key) => values[key]);
    event.system.unshift({ type: 'text', text });
    // OpenCode's built-in Claude Agent hook snapshots instructions before
    // managed plugins run; that adapter reads this option, not event.system.
    if (event.model?.providerID === 'claude-agent') {
      event.options.claudeCodeInstructions = [text, event.options.claudeCodeInstructions].filter(Boolean).join('\n\n');
    }
  });
  return async () => { controller.abort(); await watcher; };
};

/** Materialize a separate plugin so other managed hooks merge independently. */
export const materializeAssistantPromptPlugin = async ({ fsPromises, path, instanceDir }) => {
  const template = await fsPromises.readFile(new URL('./assistant-prompt.md', import.meta.url), 'utf8');
  const directory = path.join(instanceDir, 'assistants', PLUGIN_ID);
  await fsPromises.mkdir(directory, { recursive: true });
  await fsPromises.writeFile(path.join(directory, 'package.json'), `${JSON.stringify({
    name: PLUGIN_ID, version: '0.0.0', private: true, type: 'module', exports: { '.': './index.js' },
  }, null, 2)}\n`, { mode: 0o600 });
  await fsPromises.writeFile(path.join(directory, 'index.js'), `export default {
  id: ${JSON.stringify(PLUGIN_ID)},
  setup: (ctx) => (${setupAssistantPrompt.toString()})(ctx, ${JSON.stringify(template)}),
}\n`, { mode: 0o600 });
  return directory;
};
