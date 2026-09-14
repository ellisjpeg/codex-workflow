# Contributing

**Workflow is not accepting pull requests, including code or documentation changes.**

A pull request (PR) asks a project's maintainer to review your proposed changes and add them to the project. Please do not open one at this time.

Bug reports and feature ideas are welcome through the [issue forms](https://github.com/ellisjpeg/codex-workflow/issues/new/choose). For security concerns, follow the [private reporting guidance](SECURITY.md#reporting-a-vulnerability).

You are welcome to explore the code and maintain your own fork under the [licence](LICENSE). The development notes below are for maintainers and personal forks, not an invitation to submit changes.

## Development setup

```sh
npm ci --engine-strict
npm run check
```

macOS and Node.js 24.15 or newer in the 24.x line, or Node.js 26 or newer, are required. The locked DOM test dependency does not support earlier 24.x versions or Node.js 25. Strict installation rejects incompatible engines instead of leaving a warning hidden in the log. CI checks the minimum 24.15.0 version and current 24.x and 26.x releases. Tests use temporary fixtures and must not modify `/Applications/ChatGPT.app`.

## Source map

| Area | Responsibility |
| --- | --- |
| `loader.cjs` | Small embedded fail-open entry; continues into the original Codex application. |
| `runtime/main.cjs`, `runtime/preload.cjs` | Active settings/IPC and renderer integration. Start with the responsible helper and its callers, rather than rewriting the whole renderer. |
| `runtime/updater.cjs`, `scripts/lib.mjs` | Release selection, compatibility, installation transactions, backups and recovery. The installer manages only main, preload and updater runtime files. |
| `scripts/setup.mjs` | Public guided installation into the existing Codex app, without creating or opening staging. Source checks do not authorise installation or an app restart. |
| `scripts/staging.mjs` | Developer-only opt-in test app for unfinished features. Run explicitly from the full source checkout; excluded from updater assets. |
| `scripts/stage-release.mjs` | Explicit updater payload and locked production-dependency staging, without pruning the contributor's `node_modules`. |
| `scripts/release-draft.mjs` | Validated release-draft arguments, exact asset/notes requirements and explicit prerelease policy. Never publishes a draft. |
| `tests/`, `docs/`, `parked/` | Regression fixtures, build-specific evidence and the documented historical renderer. Some tests intentionally execute the parked renderer; it is not deployed. |

`runtime/task-run-profiles.cjs` and `runtime/tool-mcp-profiles.cjs` are deferred, documented policy modules with their own tests. They are retained for development and forks, but are not loaded into the current app or included in the updater asset. Do not mistake retained migration keys or historical fixtures for proven dead code.

Main and updater keep standalone version parsing/comparison because staging deliberately replaces the updater. Changes must preserve agreement between update visibility and release selection, including malformed versions, prereleases and build metadata. They must not add an undeployed runtime dependency.

## Verification and release boundary

Run `npm run check` and `npm audit --audit-level=moderate`; do not run automatic audit fixes as part of a cleanup. Tests cover fixtures, including simulated DOM and IPC. They do not establish pixel geometry, accessibility behaviour in Electron, or a successful native restart.

On the audited macOS build, use `npm run status --silent` to choose the guarded dry-run: an already patched app uses `npm run reapply:patch -- --dry-run`; a supported stock app uses `npm run install:patch -- --dry-run`. Stop on recovery or unsupported-state reports. Do not install merely to make a source/runtime mismatch disappear.

Before promotion, inspect the changed controls in a verified isolated staging clone, including keyboard interaction, theme/zoom/narrow layouts, persistence, native-page return and relevant teardown paths. Record what was actually checked and what was not. Never substitute an older build's visual evidence for a new check.

`node scripts/stage-release.mjs <version> <new-directory>` builds the updater tree from the same code used by the release workflow. Tag, package, lockfile and compatibility versions must agree. Staging rejects an existing destination, linked payloads and installed dependency-version drift, preserves dependency licence notices, and excludes development dependencies. Archive tests exercise the packaged ASAR dependency rather than resolving it from the checkout. The full source checkout remains the development and fork distribution; `private: true` prevents accidental npm publication, not GitHub source releases.

Keep release assets separate from a working checkout. Do not include proprietary application bundles, local evidence, credentials or account data. Review the provenance and redistribution rights of native-derived preview/icon material rather than assuming the repository's MIT licence grants rights to upstream material.

Tag pushes now create drafts, including for stable-looking tags. Prerelease
status follows the validated SemVer prerelease field, not a display title or
a hyphen in build metadata. Maintainers review and publish separately; retries
must not delete an existing release or overwrite its assets automatically.
See [the alpha release checklist](docs/ALPHA_RELEASE.md). The reduced updater
asset intentionally excludes release-only scripts and test dependencies.

## Local change checklist

- Keep changes focused and reversible.
- Add regression coverage for bug fixes and durable behavior.
- Preserve current settings, backups, rollback journals, and source fingerprints.
- Do not add document-wide polling or observers for steady-state UI work.
- Do not include app bundles, extracted proprietary assets, credentials, logs, user data, or machine-specific paths.
- Report behavioural comparisons and measured changes separately from estimates. With inherited dirty work, compare against the preserved input snapshot, not just Git HEAD.

Codex Desktop updates require a fresh audit of bundle identity, app version/build, ASAR integrity, preload support, native DOM contracts, selectors, install, recovery, and uninstall behavior.
