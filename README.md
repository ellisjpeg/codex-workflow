# Codex Workflow

[![CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Codex Workflow is a version-guarded, native-style extension for Codex Desktop on macOS. It adds a Workflow settings page, focused interface controls, and a scoped synchronizer designed to avoid unrelated renderer work.

This is an independent community project and is not affiliated with or endorsed by OpenAI.

## Features

- Native-style **Workflow** category in Codex Settings.
- **Focused Interface** master switch with individual visibility controls.
- Optional hiding of **Pull requests**, account-menu pet controls, and **Invite a friend**.
- Native hover-reveal **Workflow Update** control in the sidebar titlebar.
- One-click quit, guarded patch application, automatic relaunch, and logged handoff failures without a dialog.
- Instant local source detection and conditional GitHub Release checks every five minutes.
- Scoped sidebar and settings observers with route/remount recovery.
- Atomic local settings persistence and visible rollback after write failures.
- Version, bundle identity, ASAR integrity, backup, transaction, recovery, and uninstall guards.

## Compatibility

- macOS
- Codex Desktop `26.820.60940` (build `7119`)
- Node.js 24 or newer

The installer intentionally refuses unreviewed Codex versions. A desktop update may change internal routes, DOM structure, preload behavior, or ASAR metadata even when the interface looks similar.

## Install

```sh
git clone https://github.com/ellisjpeg/codex-workflow.git
cd codex-workflow
npm ci
npm run check
npm run status
```

Use the action reported by `npm run status`:

```sh
# Supported stock installation
npm run install:patch -- --dry-run

# Existing Workflow installation
npm run reapply:patch -- --dry-run
```

Quit Codex Desktop before running the corresponding command without `--dry-run`:

```sh
npm run install:patch
# or
npm run reapply:patch
```

Relaunch Codex and run `npm run status` again. A healthy installation reports `ok: true`, matching integrity, current runtime files, and no pending transaction.

After installation, Workflow watches the configured local checkout and checks packaged GitHub Releases every five minutes using conditional requests. When an update is available, the sidebar titlebar shows Codex's native icon-to-pill hover treatment. Clicking it quits ChatGPT, applies the guarded reapply transaction, and relaunches the app. The background agent uses the same transaction but never opens ChatGPT when it was already closed.

## Recovery and removal

If status reports a recoverable interrupted transaction, quit Codex and run:

```sh
npm run recover:patch
```

To restore the verified source backup:

```sh
npm run uninstall:patch
```

## How it works

The installer replaces the app's main entry with a small fail-open loader. Feature code remains in `~/Library/Application Support/Codex Workflow`, while the loader continues to the original Codex entry even if Workflow cannot load.

Before modifying the app, the installer validates the bundle identifier, package name, supported version, original entry, and Electron ASAR integrity. It keeps a source backup and a durable rollback journal covering both the app bundle and managed runtime files.

Release tags build a self-contained `codex-workflow-<version>.tar.gz` asset. The updater requires GitHub's SHA-256 asset digest to match before extracting it, rejects unsafe archive paths, and still refuses unsupported Codex builds.

## Safety notes

- The patch modifies `/Applications/ChatGPT.app`; keep a current backup and use only the guarded commands.
- Never use `--allow-version` without reviewing the new Codex build.
- Quit Codex before install, reapply, recovery, or uninstall.
- Settings, logs, backups, and transactions remain local to the current macOS user.
- The background updater contacts only the configured GitHub Releases API and can be removed with the normal uninstall command.
- Modifying an installed app may affect its macOS code-signature status. Workflow reports signature and ASAR integrity separately.

## Development

```sh
npm ci
npm run check
npm run status
```

Pull requests should include focused regression coverage and must not install into the contributor's live Codex app as part of automated tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

MIT © ellisjpeg. See [LICENSE](LICENSE).
