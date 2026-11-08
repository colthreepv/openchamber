# Personal releases

`personal` is the default branch of `colthreepv/openchamber` and the release
integration branch. Work in the main checkout.

## Composition

- Stable upstream base: `v2.7.0`. Update only to an explicitly chosen stable tag.
- Merge `assistants` for assistant navigation, canonical conversations, identity
  injection and OpenCodex dictation. Feature fixes belong on `assistants` first.
- `assistant-memory` is excluded.

```sh
git fetch upstream --tags
git switch personal
git merge --no-ff <accepted-stable-tag>
git merge --no-ff assistants
bun install --frozen-lockfile
bun run check:changed -- --base <accepted-stable-tag>
git push origin personal
```

Update the base above when accepting a new tag. Resolve conflicts while retaining
both upstream behavior and assistant identity. Feature behavior and focused tests
are documented in [ASSISTANTS.md](ASSISTANTS.md).

## Release

Each push to `personal`, or a manual run, starts `.github/workflows/personal.yml`.
It builds Windows x64 and Linux x64 servers with browser UI, and a signed Android
APK from the same commit. Publication waits for all builds and focused tests.
Releases include SHA-256 checksums and a commit manifest. Versions are
`<base-version>-personal.<run-number>`; tags use `personal/v<version>` to avoid
triggering the official `v*` release workflow. A failed run publishes nothing.

```sh
gh workflow run personal.yml --ref personal --repo colthreepv/openchamber
```

The APK is `OpenChamber Personal`, ID `com.openchamber.app.personal`, signed
with the fork's `PERSONAL_ANDROID_*` secrets. Preserve the signing key to keep
Android upgrades installable. The local recovery copy is under
`~/.openchamber-personal/`, outside the repository. Official Firebase settings
do not cover this app ID, so background push is unavailable. Connect the app
to the chosen personal server; its bundled UI updates only with a new APK.

Installations on Bangkokian and Carlino are explicit operations after CI passes.
The workflow never installs or restarts either machine. Keep server and APK on
the same personal release. Do not use the upstream self-update action for these
installations, because it replaces the personal features with the official build.

## Server installation

Extract the matching server archive to its own directory. Install Node.js
24.14+ and OpenCode on that machine, with `opencode` on PATH. The archive
includes platform dependencies, the SDK and both web surfaces. No checkout or
dependency install is needed on the target. Launchers deliberately use Node,
because these packed dependencies use its native PTY backend.

```powershell
# Windows, from the extracted directory
.\openchamber.cmd serve --port 3000 --foreground
```

```sh
# Linux, from the extracted directory
./openchamber serve --port 3000 --foreground
```

Use the existing server's data directory when replacing it, after stopping it.
Configure remote access and authentication separately using the supported CLI
options in `packages/web/README.md`. The archive preserves the official defaults.
