# Codex Workflow

[![CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Codex Workflow is a version-guarded, native-style extension for Codex Desktop on macOS. It adds a Workflow settings page, focused interface controls, and a scoped synchronizer designed to avoid unrelated renderer work.

This is an independent community project and is not affiliated with or endorsed by OpenAI.

## Features

- Native-style **Workflow** category in Codex Settings.
- **Focused Interface** master switch with individual visibility controls.
- Optional hiding of **Pull requests**, account-menu pet controls, and **Invite a friend**.
- Optional sidebar **Settings** shortcut with **Help & Updates** moved into the account menu.
- Independent option to hide the idle composer microphone button.
- **Customise settings sidebar**: hide or restore native Settings pages without disabling features; hidden pages remain searchable and accessible in a non-sticky **Hidden** disclosure. Workflow cannot be hidden.
- Native hover-reveal **Workflow Update** control in the sidebar-aligned titlebar region.
- One-click guarded runtime updates in the Workflow sidebar pill, with automatic relaunch and logged failures.
- Immediate startup/visibility checks plus five-minute conditional GitHub Release checks with bounded backoff.
- Optional exact-build automatic repair after a Codex Desktop replacement.
- Scoped sidebar and settings observers with route/remount recovery.
- Atomic local settings persistence and visible rollback after write failures.
- Version, bundle identity, ASAR integrity, backup, transaction, recovery, and uninstall guards.

## Compatibility

Sidebar customisation in the 0.5.15 candidate has source/fixture coverage; live visual review is pending. See [the evidence and manual review checklist](docs/SETTINGS_SIDEBAR_CUSTOMISATION.md).

- macOS
- Codex Desktop `26.901.31953` (build `7868`)
- Node.js 24 or newer

The installer intentionally refuses unreviewed Codex versions and builds. A desktop update may change internal routes, DOM structure, preload behavior, or ASAR metadata even when the interface looks similar.

## Install

```sh
git clone https://github.com/ellisjpeg/codex-workflow.git
cd codex-workflow
npm ci
npm run setup -- --auto-repair
```

The setup command runs each source/status/preflight gate once, opens at most one isolated staging app, accepts `y` or `yes`, removes staging on normal exit, cancellation, `HUP`, `INT`, or `TERM`, waits for Codex to quit, installs once, verifies the result, and relaunches once. Detailed output is kept in the reported temporary log only when a step fails.

Automatic repair is opt-in. Omit `--auto-repair` to install without it. An agent or other noninteractive runner can provide the same explicit approval with:

```sh
npm run setup -- --yes --auto-repair
```

The command is idempotent: if Workflow is already current it reports that state without launching or reinstalling anything. Recovery and unsupported states stop for inspection instead of being guessed through.

After installation, Workflow checks packaged GitHub Releases at app startup and when the app becomes active, then no more often than every five minutes. Checks use ETags and exponential failure backoff capped at one hour. Only a verified staged release whose compatibility manifest matches the exact Codex version/build can surface the existing Workflow sidebar update pill; local checkout or commit drift is ignored. Clicking the pill applies a guarded external-runtime transaction, then relaunches Codex. Releases that change the embedded loader still require a reviewed guarded reapply.

When `--auto-repair` was selected, the machine-local background agent can detect that Codex replaced the patched app. If no exact-build verified release exists, it records that state and shows one notification for the new build instead of failing silently or prompting repeatedly. When a compatible release exists, it waits for the app and bundle to become quiescent, runs the normal journaled installer once, verifies runtime hashes, ASAR integrity, and the ad-hoc signature, then relaunches once. An unknown build, pending recovery, failed attempt, or running app stops or defers safely; it never uses `--allow-version` or consumes the source backup.

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
- After install, Workflow ad-hoc re-signs the patched app so macOS will launch it. Uninstall restores the original Apple signature when that backup exists.
- Never use `--allow-version` without reviewing the new Codex build.
- Automatic post-update repair is disabled unless installation used `--auto-repair`.
- Quit Codex before install, reapply, recovery, or uninstall.
- Settings, logs, backups, and transactions remain local to the current macOS user.
- The background updater contacts only the configured GitHub Releases API and can be removed with the normal uninstall command.
- Modifying an installed app invalidates its original Apple code signature. Workflow now ad-hoc re-signs after install so the app can launch, and reports signature and ASAR integrity separately.

## Development

```sh
npm ci
npm run check
npm run status
```

Pull requests should include focused regression coverage and must not install into the contributor's live Codex app as part of automated tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Maintainers can prepare one isolated live-test clone with `npm run staging -- prepare --port <unique-port>`. The emitted manifest is required by the `launch`, `stop`, `restore`, and `cleanup` subcommands. The helper creates its own bundle identity, executable, home, temporary files, user data, `CODEX_HOME`, Workflow runtime, settings, logs, updates, backups, and transaction path under one short validated `/private/tmp` root. It launches with an allowlisted environment, proves the prepared fingerprint and loopback-only DevTools listener, disables Sparkle, installs a fail-closed staging updater, and never installs a LaunchAgent.

## License

MIT © ellisjpeg. See [LICENSE](LICENSE).
