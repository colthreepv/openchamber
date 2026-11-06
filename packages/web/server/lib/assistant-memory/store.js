// Paid-for summaries survive every rebuild of the derived message-search index.
export const openAssistantMemoryStore = (db) => {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(`CREATE TABLE IF NOT EXISTS memory_meta (version INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS memory_nodes (
      session TEXT NOT NULL, level INTEGER NOT NULL, slot INTEGER NOT NULL,
      value TEXT NOT NULL, PRIMARY KEY (session, level, slot))`);
  const version = db.get('SELECT version FROM memory_meta');
  if (version && version.version !== 1) { db.close(); throw new Error('Unsupported assistant memory schema'); }
  if (!version) db.run('INSERT INTO memory_meta VALUES (1)');
  const list = (session) => db.all('SELECT value FROM memory_nodes WHERE session = ? ORDER BY level, slot', [session]).map((r) => JSON.parse(r.value));
  return {
    list,
    get: (session, level, index) => {
      const row = db.get('SELECT value FROM memory_nodes WHERE session = ? AND level = ? AND slot = ?', [session, level, index]);
      return row ? JSON.parse(row.value) : null;
    },
    put: (session, nodes) => db.transaction(() => {
      for (const node of nodes) {
        const saved = { ...node };
        delete saved.user;
        db.run('INSERT OR REPLACE INTO memory_nodes VALUES (?, ?, ?, ?)', [session, node.level, node.index, JSON.stringify(saved)]);
      }
    }),
    invalidate: (session, first) => db.transaction(() => {
      for (const node of list(session)) {
        if ((node.index + 1) * 2 ** node.level > first) db.run('DELETE FROM memory_nodes WHERE session = ? AND level = ? AND slot = ?', [session, node.level, node.index]);
      }
    }),
    close: () => db.close(),
  };
};
