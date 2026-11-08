import { chmodSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const directory = path.resolve(process.argv[2]);
// Packed servers use Node's node-pty; Bun's patched PTY is a checkout-only build.
writeFileSync(path.join(directory, 'openchamber.cmd'), '@echo off\r\nset "BUN_BINARY=%~dp0no-bun-runtime"\r\nnode "%~dp0node_modules\\@openchamber\\web\\bin\\cli.js" %*\r\n');
writeFileSync(path.join(directory, 'openchamber'), '#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\nexport BUN_BINARY="$ROOT/no-bun-runtime"\nexec node "$ROOT/node_modules/@openchamber/web/bin/cli.js" "$@"\n');
chmodSync(path.join(directory, 'openchamber'), 0o755);
