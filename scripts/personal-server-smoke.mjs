import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';

const directory = path.resolve(process.argv[2]);
const cli = path.join(directory, 'node_modules/@openchamber/web/bin/cli.js');
const requirePackage = createRequire(cli);
const pty = requirePackage('node-pty').spawn(process.execPath, ['-e', 'process.stdout.write("PERSONAL_PTY_OK")'], {
  cwd: directory, env: process.env,
});
await new Promise((resolve, reject) => {
  let text = '';
  const deadline = globalThis.setTimeout(() => {
    pty.kill();
    reject(new Error('Packaged PTY did not exit in 10 seconds'));
  }, 10_000);
  pty.onData((chunk) => { text += chunk; });
  pty.onExit(({ exitCode }) => {
    clearTimeout(deadline);
    pty.destroy();
    try {
      assert.equal(exitCode, 0);
      assert.match(text, /PERSONAL_PTY_OK/);
      resolve();
    } catch (error) { reject(error); }
  });
});
accessSync(path.join(directory, 'node_modules/@openchamber/web/server/lib/assistants/assistant-prompt.md'));
const home = mkdtempSync(path.join(tmpdir(), 'personal-server-smoke-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(OPENCHAMBER_|OPENCODE_|BUN_)/.test(key)));
Object.assign(env, {
  HOME: home, USERPROFILE: home,
  XDG_CONFIG_HOME: path.join(home, 'config'), XDG_DATA_HOME: path.join(home, 'data'),
  OPENCHAMBER_DATA_DIR: path.join(home, 'openchamber'),
  OPENCHAMBER_RELAY_HOST: 'off', BUN_BINARY: path.join(home, 'no-bun-runtime'),
  OPENCODE_SKIP_START: 'true',
});
const version = spawnSync(process.execPath, [cli, '--version'], { env, encoding: 'utf8' });
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), process.env.EXPECTED_VERSION);
const reservation = createServer();
await new Promise((resolve, reject) => {
  reservation.once('error', reject);
  reservation.listen(0, '127.0.0.1', resolve);
});
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const baseUrl = `http://localhost:${port}`;
const child = spawn(process.execPath, [cli, 'serve', '--port', String(port), '--foreground'], {
  cwd: home, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
try {
  const deadline = Date.now() + 60_000;
  let health;
  while (Date.now() < deadline && child.exitCode === null) {
    health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
      .then((response) => response.json()).catch(() => null);
    if (health?.openchamberVersion === process.env.EXPECTED_VERSION) break;
    await setTimeout(250);
  }
  assert.equal(health?.openchamberVersion, process.env.EXPECTED_VERSION, output);
  assert.ok(health.compatibility.capabilities.includes('ui.assistants.v1'));
  for (const route of ['/', '/mobile.html']) {
    const response = await fetch(`${baseUrl}${route}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<html/);
  }
  console.log('Packaged server version, native PTY execution, assistant capability and browser/mobile assets passed.');
} finally {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  } else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* The process already exited. */ }
  }
}
