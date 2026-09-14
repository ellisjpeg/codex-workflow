# Codex Workflow

[![CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Workflow lets you customise Codex to suit the way you work. It brings your preferences into the app through a native-feeling interface, with local settings and a reversible installation.

Workflow is built around personal control: shape your workspace, keep useful controls within reach, and make the interface fit your routine. Each customisation belongs to one integrated settings experience.

This is an independent community project and is not affiliated with or endorsed by OpenAI.

See the [changelog](CHANGELOG.md) for release-specific changes and the compatibility section below before installing.

## Public Alpha 1

**Workflow Alpha 1 (`0.5.42`)** is a regular Latest release. Alpha describes the
unfinished product scope; the included features must meet their release checks.
Install only on the
exact supported Codex build and be prepared to use the guarded removal path.
The commands below require the published `v0.5.42` tag; a local candidate
or a green badge for another commit does not establish release readiness.
See the [alpha notes](docs/releases/0.5.42.md) for scope and limitations.

## Compatibility

Current sidebar evidence is recorded in [Sidebar & navigation](docs/SIDEBAR_NAVIGATION.md).
Composer controls, native preview, width behaviour and staging verification are documented in [Composer settings](docs/COMPOSER_SETTINGS.md).
Conversation width, spacing, message styles, activity and timestamps are documented in [Conversation settings](docs/CONVERSATION_SETTINGS.md).

- macOS
- Codex Desktop `26.908.40834` (build `8881`)
- Node.js 24.15 or newer in the 24.x line, or Node.js 26 or newer

Native acceptance has been exercised on Apple Silicon (arm64). Intel-native
installation and UI behaviour have not yet been verified; this alpha does not
claim an Intel acceptance pass. Node checks cover 24.15.0 and the 24.x/26.x
matrix, not every later Node major allowed by the package engine range.

The installer intentionally refuses unreviewed Codex versions and builds. A desktop update may change internal routes, DOM structure, preload behavior, or ASAR metadata even when the interface looks similar.

Build `8881` contracts and prior live verification are recorded in the [native dropdowns and update audit](docs/NATIVE_DROPDOWNS_8881.md). Current usage controls are described in [Usage & indicators](docs/USAGE_REMAINING.md). Historical verification is not a substitute for checking a changed release candidate.

## Install

```sh
git clone --branch v0.5.42 --single-branch https://github.com/ellisjpeg/codex-workflow.git codex-workflow-alpha-1
cd codex-workflow-alpha-1
npm ci --engine-strict
npm run setup -- --no-auto-repair
```

The setup command runs each source/status/preflight gate once, opens at most one isolated staging app, accepts `y` or `yes`, removes staging on normal exit, cancellation, `HUP`, `INT`, or `TERM`, waits for Codex to quit, installs once, verifies the result, and relaunches once. Detailed output is kept in the reported temporary log only when a step fails.

Use a new checkout rather than switching a working tree with local edits.
Keep the checkout for status, recovery and removal. Review the staging window
and save your work before agreeing to quit Codex.

The alpha instructions explicitly disable automatic repair when installation
runs, including when upgrading an existing installation that enabled it.
Omitting the flag preserves an existing repair preference; it is not equivalent
to `--no-auto-repair`. An already-current setup exits without changing preferences.
An agent or other noninteractive runner can provide the same explicit installation approval with:

```sh
npm run setup -- --yes --no-auto-repair
```

The command is idempotent: if Workflow is already current it reports that state without launching or reinstalling anything. Recovery and unsupported states stop for inspection instead of being guessed through.

### Updates

For a manual upgrade, read the release notes and use
the exact tagged source checkout with the guarded setup command. Do not use a
moving `main` checkout or the reduced updater archive for this install flow.
The source checkout includes the tests required by setup; the updater archive
does not support `npm run check` or `npm run setup` on its own.

The default updater uses GitHub's `/releases/latest` endpoint. Workflow Alpha 1
is a regular release on that feed, so compatible existing installations can
receive it through Update Workflow. There is no separate alpha channel. Automatic
repair is separate from those checks and is disabled by the command above.

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

Removal restores Codex's original entry and ASAR contents with a valid ad-hoc
signature. It does not restore Apple's original trust chain; reinstall the
official Codex app if you need the vendor-signed bundle. Recovery also repairs
the local signature when an interrupted installation or an older backup left
its signature metadata incomplete.

## How it works

The installer replaces the app's main entry with a small fail-open loader. Feature code remains in `~/Library/Application Support/Codex Workflow`, while the loader continues to the original Codex entry even if Workflow cannot load.

Before modifying the app, the installer validates the bundle identifier, package name, supported version, original entry, and Electron ASAR integrity. It keeps a source backup and a durable rollback journal covering both the app bundle and managed runtime files.

Release tags build a self-contained `codex-workflow-<version>.tar.gz` installation asset from an explicit file list and locked production dependencies. It contains only the three active runtime files; deferred policy modules, parked fixtures and development tests remain in the source checkout. The updater verifies GitHub's SHA-256 asset digest before extraction, rejects unsafe paths and entry types, and still refuses unsupported Codex builds. Use the source checkout, not this asset, for development and `npm run check`.

## Safety notes

- The patch modifies `/Applications/ChatGPT.app`; keep a current backup and use only the guarded commands.
- After install, Workflow ad-hoc re-signs the patched app so macOS will launch it. Uninstall restores the original Apple signature when that backup exists.
- Never use `--allow-version` without reviewing the new Codex build.
- Automatic post-update repair is disabled unless installation used `--auto-repair`.
- Quit Codex before install, reapply, recovery, or uninstall.
- Settings, logs, backups, and transactions remain local to the current macOS user.
- The updater contacts the configured GitHub Releases API and follows its release-asset URLs and redirects. It can be removed with the normal uninstall command; see [SECURITY.md](SECURITY.md) for the trust boundary.

## Development

```sh
npm ci --engine-strict
npm run check
npm run status
```

Pull requests should include focused regression coverage and must not install into the contributor's live Codex app as part of automated tests. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

Maintainers can prepare one isolated live-test clone with `npm run staging -- prepare --port <unique-port>`. The emitted manifest is required by the `launch`, `stop`, `restore`, and `cleanup` subcommands. The helper creates its own bundle identity, executable, shell startup directory, temporary files, user data, `CODEX_HOME`, Workflow runtime, settings, logs, updates, backups, and transaction path under one short validated `/private/tmp` root. It launches with an allowlisted environment, proves the prepared fingerprint and loopback-only DevTools listener, disables Sparkle, installs a fail-closed staging updater, and never installs a LaunchAgent.

## License

Workflow-authored code is MIT © ellisjpeg. See [LICENSE](LICENSE). Embedded
third-party icons and packaged dependencies retain their own notices; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
