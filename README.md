# Codex Workflow

[![CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Workflow lets you customise Codex to suit the way you work. It brings your preferences into the app through a native-feeling interface, with local settings and a reversible installation.

Workflow is built around personal control: shape your workspace, keep useful controls within reach, and make the interface fit your routine. Each customisation belongs to one integrated settings experience.

This is an independent community project and is not affiliated with or endorsed by OpenAI.

See the [changelog](CHANGELOG.md) for release-specific changes and the compatibility section below before installing.

## Compatibility

Current sidebar evidence is recorded in [Sidebar & navigation](docs/SIDEBAR_NAVIGATION.md).
Composer controls, native preview, width behaviour and staging verification are documented in [Composer settings](docs/COMPOSER_SETTINGS.md).
Conversation width, spacing, message styles, activity and timestamps are documented in [Conversation settings](docs/CONVERSATION_SETTINGS.md).

- macOS
- Codex Desktop `26.908.40834` (build `8881`)
- Node.js 24 or newer

The installer intentionally refuses unreviewed Codex versions and builds. A desktop update may change internal routes, DOM structure, preload behavior, or ASAR metadata even when the interface looks similar.

Build `8881` is covered by the [compatibility audit](docs/CODEX_26.908.40834_AUDIT.md).

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

After installation, Workflow checks packaged GitHub Releases at app startup and when the app becomes active, then no more often than every five minutes. Checks use ETags and exponential failure backoff capped at one hour. Only a verified staged release whose compatibility manifest matches the exact Codex version/build can show Update Workflow in Workflow settings; local checkout or commit drift is ignored. Clicking Update Workflow applies a guarded external-runtime transaction, then relaunches Codex. Releases that change the embedded loader still require a reviewed guarded reapply.

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

Maintainers can prepare one isolated live-test clone with `npm run staging -- prepare --port <unique-port>`. The emitted manifest is required by the `launch`, `stop`, `restore`, and `cleanup` subcommands. The helper creates its own bundle identity, executable, shell startup directory, temporary files, user data, `CODEX_HOME`, Workflow runtime, settings, logs, updates, backups, and transaction path under one short validated `/private/tmp` root. It launches with an allowlisted environment, proves the prepared fingerprint and loopback-only DevTools listener, disables Sparkle, installs a fail-closed staging updater, and never installs a LaunchAgent.

## License

MIT © ellisjpeg. See [LICENSE](LICENSE).
