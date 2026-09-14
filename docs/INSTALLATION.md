# Installation and technical notes

[← Back to Workflow](../README.md)

## Alpha update

**Workflow `0.5.43`** removes developer staging from public setup. The older `0.5.42` tag still uses the staging flow. Alpha describes the unfinished product scope; see the release notes for verification and limitations.
Install only on the exact supported Codex build and be prepared to use the guarded removal path.
The commands below require the published `v0.5.43` tag; a local candidate
or a green badge for another commit does not establish release readiness.
See the [alpha notes](releases/0.5.43.md) for scope and limitations.

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

The exact source guard is recorded in [workflow-compatibility.json](../workflow-compatibility.json). Build-specific behaviour and verification are linked under [Documentation](../README.md#documentation); historical evidence is not a substitute for checking a changed release candidate.

## Install

Check compatibility above before running these commands in Terminal. Use a fresh checkout of the published tag, not a moving `main` branch or the reduced updater archive.

```sh
git clone --branch v0.5.43 --single-branch https://github.com/ellisjpeg/codex-workflow.git codex-workflow-alpha-1
cd codex-workflow-alpha-1
npm ci --engine-strict
npm run setup -- --no-auto-repair
```

Setup checks the existing Codex app and asks before installing Workflow into it. Save your work before agreeing to quit Codex. Existing installations use the guarded reapply path. Setup never creates or opens Codex Workflow Staging. Keep this checkout for status, recovery and removal.

**Installation modifies the local Codex app bundle and replaces its vendor signature with an ad-hoc signature.** Read [Safety notes](#safety-notes) and [Recovery and removal](#recovery-and-removal) before proceeding.

The alpha instructions explicitly disable automatic repair when installation
runs, including when upgrading an existing installation that enabled it.
Omitting the flag preserves an existing repair preference; it is not equivalent
to `--no-auto-repair`. An already-current setup exits without changing preferences.

<details>
<summary>Setup behaviour and noninteractive use</summary>

The setup command runs each source/status/preflight gate once, accepts `y` or `yes`, waits for Codex to quit, installs once, verifies the result, and relaunches Codex once. Declining or interrupting approval leaves Codex unchanged. It does not prepare, launch or manage a staging app. Detailed output is kept in the reported temporary log only when a step fails.

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

The default updater uses GitHub's `/releases/latest` endpoint. `0.5.43` is a regular Latest release, so compatible existing installations can receive it through Update Workflow. There is no separate alpha channel. Automatic
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

Release tags build a self-contained `codex-workflow-<version>.tar.gz` installation asset from an explicit file list and locked production dependencies. It contains only the three active runtime files alongside the guarded installer helpers; developer staging scripts, deferred policy modules, parked fixtures and development tests remain in the source checkout. The updater verifies GitHub's SHA-256 asset digest before extraction, rejects unsafe paths and entry types, and still refuses unsupported Codex builds. Use the source checkout, not this asset, for development and `npm run check`.

## Safety notes

- The patch modifies `/Applications/ChatGPT.app`; keep a current backup and use only the guarded commands.
- Installation and removal use ad-hoc signing. Removal restores the original app contents, not Apple's original trust chain; reinstall the official Codex app to return to a vendor-signed bundle.
- Never use `--allow-version` without reviewing the new Codex build.
- The documented installation command explicitly disables automatic post-update repair. Omitting the flag preserves an existing preference; an already-current setup does not change it.
- Quit Codex before install, reapply, recovery, or uninstall.
- Settings, logs, backups, and transactions remain local to the current macOS user.
- The updater contacts the configured GitHub Releases API and follows its release-asset URLs and redirects. It can be removed with the normal uninstall command; see [SECURITY.md](../SECURITY.md) for the trust boundary.

## Development

[![CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml/badge.svg)](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)

Fork or clone the source repository for development. From your checkout:

```sh
npm ci --engine-strict
npm run check
npm run status
```

Local development checks also include `npm audit --audit-level=moderate`. Keep focused regression coverage and never install into a live Codex app as part of automated tests. **Workflow is not accepting pull requests.** These instructions support maintainers and personal forks. Read [CONTRIBUTING.md](../CONTRIBUTING.md) for the source map and verification boundaries, and [SECURITY.md](../SECURITY.md) for the trust model.

Deferred policy modules and historical fixtures remain in the source tree for development and forks; their presence does not mean they are loaded into the app or included in an updater release. Start with the active source map rather than assuming every retained module is a shipped capability.

<details>
<summary>Isolated native verification for maintainers</summary>

Codex Workflow Staging is a developer-only test app for unfinished features. It is not a public installation step or a distributed app; the updater asset excludes its helpers. Maintainers explicitly opt into staging from a full source checkout and can prepare one isolated live-test clone with `npm run staging -- prepare --port <unique-port>`. The emitted manifest is required by the `launch`, `stop`, `restore`, and `cleanup` subcommands. The helper creates its own bundle identity, executable, shell startup directory, temporary files, user data, `CODEX_HOME`, Workflow runtime, settings, logs, updates, backups, and transaction path under one short validated `/private/tmp` root. It launches with an allowlisted environment, proves the prepared fingerprint and loopback-only DevTools listener, disables Sparkle, installs a fail-closed staging updater, and never installs a LaunchAgent.

</details>
