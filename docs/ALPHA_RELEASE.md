# Alpha release procedure

This is a maintainer checklist, not a release sign-off. It does not authorise
publishing, an app install, or a restart. Keep raw evidence outside public
source. The intended Alpha 1 version is `0.5.42`, titled **Workflow Alpha 1**.
It is a regular Latest release; Alpha describes unfinished product scope.

## Before public source upload

Resolve the redistribution basis of every native-derived asset in source,
including historical/parked copies and test fixtures. A notice for Lucide does
not cover unrelated captured Codex HTML or glyphs. Preserve full required
notices in both source and updater assets. Review the exact public diff for
credentials, personal information, proprietary bundles, raw logs and private
capture data. An automated pattern scan alone is not a privacy clearance.

Integrate only reviewed changes and freeze one final inventory. Versions in
the package, lockfile root/package entry, compatibility manifest, changelog,
release notes, tag and asset name must agree. Confirm the source installation
instructions pin that exact tag. Do not version-bump the supported Codex build.

## Local and native gates

Run strict clean installation, dependency audit, `npm run check` and packaging
tests against the combined source on the minimum Node and supported CI lines.
Build the actual archive, confirm its regular-file/directory-only contents,
required notices, metadata, runtime hashes and production dependency closure.
Record source identity and archive SHA-256. Equal extracted file hashes are
content reproducibility; do not promise byte-identical gzip archives from
different environments without separately proving it.

Relate prior native acceptance to exact runtime hashes. Documentation-only
changes do not invalidate unchanged UI evidence, but a modified native preview
or glyph needs focused new cold-entry, sanitisation, theme/width, interaction
and remount verification. Version metadata changes require installation/status
verification of the new version; an old runtime pass is not that check.

Exercise the documented source install/reapply and removal/recovery paths in a
verified isolated environment. The normal staging helper has a fail-closed
updater, so an ordinary staging restart is not an updater acceptance pass.
The normal installer library contains production defaults: merely changing
CODEX_WORKFLOW_ROOT or enabling staging's stub is not safe isolation. Do not
run a real updater against a production app to close this gate. Use a reviewed
isolated adapter/harness, disclose any instrumentation, and never claim a
source-modified test double proves the untouched public installer.

## Hosted checks and draft creation

After approval to upload, commit the reviewed source, push a dedicated branch
and open a pull request. CI currently runs on pull requests and pushes to
`main`; a feature-branch push alone does not run it. Require green checks for
the exact reviewed commit/merge result, not an old baseline badge. Merge only
after approval and preserve the relationship to the tested inventory.

After approval to tag, push only the intended version tag on that reviewed
commit. The release workflow checks source, builds the archive and calls:

```sh
node scripts/release-draft.mjs v0.5.42 dist/codex-workflow-0.5.42.tar.gz
```

This creates a **draft**, requires an existing tag and version-specific notes,
sets prerelease for SemVer prereleases, and passes `--latest=false`. It is a
remote write, not a local preview command. It never edits/publishes/deletes an
existing release. A failed/repeated run needs inspection, not automatic asset
replacement. Prefer tagging the reviewed default-branch commit: GitHub can
require additional workflow permissions when a release target changes workflow
files relative to the default branch; do not broaden token permissions blindly.

Review draft tag/commit, prerelease flag, notes, compatibility and asset digest.
The build workflow does not by itself prove provenance or native installation.
Publish only after the applicable gates and explicit approval. For the approved
Alpha 1 classification, set title `Workflow Alpha 1`, `prerelease=false` and
Latest when publishing the reviewed draft. The draft helper never publishes.

## After publication, before broad announcement

Fetch the exact tag's published release without maintainer authentication.
Require `draft=false`, `prerelease=false`, the intended tag, expected asset name,
size and SHA-256 digest. Download and verify the bytes, inspect the archive,
and compare extracted files to the reviewed source. Check that
`/releases/latest` resolves to `v0.5.42`.

Perform the final public-artifact install/update/relaunch check in the verified
isolated arrangement: exact installed version/runtime hashes, settings
preservation, no pending journal/error, and a genuine process restart. Verify
removal/restoration and clean up only the owned stage. A draft cannot provide
an unauthenticated public-download check; distinguish prepublication local
proof from this final distribution proof.

Retain a sanitised release evidence summary referencing the final commit and
asset digest. Any unresolved gate stays explicit; "alpha" is not a waiver for
unsafe installation or unresolved redistribution.

## Primary references

- GitHub CLI release creation: https://cli.github.com/manual/gh_release_create
- Release API and latest/tag discovery: https://docs.github.com/en/rest/releases/releases
- Publishing an approved draft: https://cli.github.com/manual/gh_release_edit
