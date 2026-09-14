# Workflow

**Make Codex yours.**

Workflow is an open-source customisation layer for Codex Desktop on macOS. It brings your preferences into the app through a native-feeling settings experience, with local control and a guarded installation.

The idea is simple: **Codex should fit the way you work, not the other way around.**

You might start with an idea and a prompt. You might arrive with an established codebase, conventions and a review process. Workflow is for people who build with prompts, code, or both.

The goal is a more personal Codex experience: room for your preferences, your projects and your process, without making the app feel unfamiliar. That direction matters more than any one setting. The [changelog](CHANGELOG.md) and [release notes](https://github.com/ellisjpeg/codex-workflow/releases) describe what is available in each release.

Workflow is an independent community project, not affiliated with or endorsed by OpenAI. It customises the local desktop app; it is not a replacement for Codex or a separate model service.

[Get started](#install) · [Compatibility](#compatibility) · [How it works](#how-it-works) · [Contribute](#help-shape-workflow)

## Public Alpha 1

**Workflow Alpha 1 (`0.5.42`)** is a regular Latest release. Alpha describes the
unfinished product scope; the included features must meet their release checks.
Install only on the exact supported Codex build and be prepared to use the guarded removal path.
The commands below require the published `v0.5.42` tag; a local candidate
or a green badge for another commit does not establish release readiness.
See the [alpha notes](docs/releases/0.5.42.md) for scope and limitations.

## Compatibility

| Requirement | Supported setup |
| --- | --- |
| Operating system | macOS |
| Codex Desktop | `26.908.40834`, build `8881` |
| Node.js | 24.15 or newer in the 24.x line, or 26 or newer |

Native acceptance has been exercised on Apple Silicon (arm64). Intel-native
installation and UI behaviour have not yet been verified; this alpha does not
claim an Intel acceptance pass. Node checks cover 24.15.0 and the 24.x/26.x
matrix, not every later Node major allowed by the package engine range.

The installer intentionally refuses unreviewed Codex versions and builds. A desktop update may change internal routes, DOM structure, preload behavior, or ASAR metadata even when the interface looks similar.

The exact source guard is recorded in [workflow-compatibility.json](workflow-compatibility.json). Build-specific behaviour and verification are linked under [Documentation](#documentation); historical evidence is not a substitute for checking a changed release candidate.

## Install

Check compatibility above before running these commands in Terminal. Use a fresh checkout of the published tag, not a moving `main` branch or the reduced updater archive.

```sh
git clone --branch v0.5.42 --single-branch https://github.com/ellisjpeg/codex-workflow.git codex-workflow-alpha-1
cd codex-workflow-alpha-1
npm ci --engine-strict
npm run setup -- --no-auto-repair
```

On a first installation, setup opens an isolated staging window for review before asking to install. Save your work before agreeing to quit Codex. An existing installation uses the guarded reapply path. Keep this checkout for status, recovery and removal rather than switching a working tree with local edits.

**Installation modifies the local Codex app bundle and replaces its vendor signature with an ad-hoc signature.** Read [Safety notes](#safety-notes) and [Recovery and removal](#recovery-and-removal) before proceeding.

The alpha instructions explicitly disable automatic repair when installation
runs, including when upgrading an existing installation that enabled it.
Omitting the flag preserves an existing repair preference; it is not equivalent
to `--no-auto-repair`. An already-current setup exits without changing preferences.

<details>
<summary>Setup behaviour and noninteractive use</summary>

The setup command runs each source/status/preflight gate once, opens at most one isolated staging app, accepts `y` or `yes`, removes staging on normal exit, cancellation, `HUP`, `INT`, or `TERM`, waits for Codex to quit, installs once, verifies the result, and relaunches once. Detailed output is kept in the reported temporary log only when a step fails.

An agent or other noninteractive runner can provide the same explicit installation approval with:

```sh
npm run setup -- --yes --no-auto-repair
```

The command is idempotent: if Workflow is already current it reports that state without launching or reinstalling anything. Recovery and unsupported states stop for inspection instead of being guessed through.

</details>

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

<details>
<summary>Release checks and optional automatic repair</summary>

After installation, Workflow checks packaged GitHub Releases at app startup and when the app becomes active, then no more often than every five minutes. Checks use ETags and exponential failure backoff capped at one hour. Only a verified staged release whose compatibility manifest matches the exact Codex version/build can show Update Workflow in Workflow settings; local checkout or commit drift is ignored. Clicking Update Workflow applies a guarded external-runtime transaction, then relaunches Codex. Releases that change the embedded loader still require a reviewed guarded reapply.

When `--auto-repair` was selected, the machine-local background agent can detect that Codex replaced the patched app. If no exact-build verified release exists, it records that state and shows one notification for the new build instead of failing silently or prompting repeatedly. When a compatible release exists, it waits for the app and bundle to become quiescent, runs the normal journaled installer once, verifies runtime hashes, ASAR integrity, and the ad-hoc signature, then relaunches once. An unknown build, pending recovery, failed attempt, or running app stops or defers safely; it never uses `--allow-version` or consumes the source backup.

</details>

## Recovery and removal

From the retained checkout, inspect the installation first:

```sh
npm run status --silent
```

If status reports a recoverable interrupted transaction, quit Codex and run:

```sh
npm run recover:patch
```

To restore the verified source backup, quit Codex and run:

```sh
npm run uninstall:patch
```

Removal restores Codex's original entry and ASAR contents with a valid ad-hoc
signature. It does not restore Apple's original trust chain; reinstall the
official Codex app if you need the vendor-signed bundle. Recovery also repairs
the local signature when an interrupted installation or an older backup left
its signature metadata incomplete.

Stop for inspection if status reports an unsafe journal, a missing backup or an unsupported state. Do not delete backups or bypass a failed guard.

## How it works

The installer replaces the app's main entry with a small fail-open loader. Feature code remains in `~/Library/Application Support/Codex Workflow`, while the loader continues to the original Codex entry even if Workflow cannot load.

Before modifying the app, the installer validates the bundle identifier, package name, supported version, original entry, and Electron ASAR integrity. It keeps a source backup and a durable rollback journal covering both the app bundle and managed runtime files.

Release tags build a self-contained `codex-workflow-<version>.tar.gz` installation asset from an explicit file list and locked production dependencies. It contains only the three active runtime files; deferred policy modules, parked fixtures and development tests remain in the source checkout. The updater verifies GitHub's SHA-256 asset digest before extraction, rejects unsafe paths and entry types, and still refuses unsupported Codex builds. Use the source checkout, not this asset, for development and `npm run check`.

## Safety notes

- The patch modifies `/Applications/ChatGPT.app`; keep a current backup and use only the guarded commands.
- Installation and removal use ad-hoc signing. Removal restores the original app contents, not Apple's original trust chain; reinstall the official Codex app to return to a vendor-signed bundle.
- Never use `--allow-version` without reviewing the new Codex build.
- The documented installation command explicitly disables automatic post-update repair. Omitting the flag preserves an existing preference; an already-current setup does not change it.
- Quit Codex before install, reapply, recovery, or uninstall.
- Settings, logs, backups, and transactions remain local to the current macOS user.
- The updater contacts the configured GitHub Releases API and follows its release-asset URLs and redirects. It can be removed with the normal uninstall command; see [SECURITY.md](SECURITY.md) for the trust boundary.

## Development

[![CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)

Fork or clone the source repository for development. From your checkout:

```sh
npm ci --engine-strict
npm run check
npm run status
```

The repository's contribution checks also include `npm audit --audit-level=moderate`. Pull requests should include focused regression coverage and must not install into the contributor's live Codex app as part of automated tests. Read [CONTRIBUTING.md](CONTRIBUTING.md) for the source map and verification boundaries, and [SECURITY.md](SECURITY.md) for the trust model.

Deferred policy modules and historical fixtures remain in the source tree for development and forks; their presence does not mean they are loaded into the app or included in an updater release. Start with the active source map rather than assuming every retained module is a shipped capability.

<details>
<summary>Isolated native verification for maintainers</summary>

Maintainers can prepare one isolated live-test clone with `npm run staging -- prepare --port <unique-port>`. The emitted manifest is required by the `launch`, `stop`, `restore`, and `cleanup` subcommands. The helper creates its own bundle identity, executable, shell startup directory, temporary files, user data, `CODEX_HOME`, Workflow runtime, settings, logs, updates, backups, and transaction path under one short validated `/private/tmp` root. It launches with an allowlisted environment, proves the prepared fingerprint and loopback-only DevTools listener, disables Sparkle, installs a fail-closed staging updater, and never installs a LaunchAgent.

</details>

## Help shape Workflow

The most useful feedback starts with a real task: what you were trying to do, where the experience got in your way, and what would work better. You do not need a code contribution to help shape the project.

For a [bug report](https://github.com/ellisjpeg/codex-workflow/issues/new?template=bug_report.yml), include the Workflow version, Codex version/build and the smallest safe reproduction. For a [feature idea](https://github.com/ellisjpeg/codex-workflow/issues/new?template=feature_request.yml), start with the problem it would solve and describe how the behaviour should change or be restored.

For code and documentation contributions, keep changes focused and follow [CONTRIBUTING.md](CONTRIBUTING.md). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md), and keep private prompts, credentials, account details and complete logs out of public reports. Report security concerns through the [private reporting guidance](SECURITY.md#reporting-a-vulnerability), not a public issue.

## Documentation

These guides describe implemented areas and their build-specific evidence, not a promise that every Codex version or future feature is supported.

| Guide | What you will find |
| --- | --- |
| [Sidebar & navigation](docs/SIDEBAR_NAVIGATION.md) | Workspace layout, navigation and shortcut behaviour. |
| [Composer settings](docs/COMPOSER_SETTINGS.md) | Composer presentation, preview and width behaviour. |
| [Conversation settings](docs/CONVERSATION_SETTINGS.md) | Message layout, spacing, styles, activity and timestamps. |
| [Usage & indicators](docs/USAGE_REMAINING.md) | Current usage controls and their limits. |
| [Build 8881 audit](docs/NATIVE_DROPDOWNS_8881.md) | Native UI contracts and prior verification. |
| [Contributing](CONTRIBUTING.md) | Source ownership, local checks and the release boundary. |

For release-specific changes, see the [changelog](CHANGELOG.md) and [published releases](https://github.com/ellisjpeg/codex-workflow/releases). For installation and update trust boundaries, see the [security policy](SECURITY.md).

## License

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Workflow-authored code is MIT © ellisjpeg. See [LICENSE](LICENSE). Embedded
third-party icons and packaged dependencies retain their own notices; see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
