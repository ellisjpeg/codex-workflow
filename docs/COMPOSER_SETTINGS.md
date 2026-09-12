# Composer settings, 0.5.33

## Approved production installation, 12 September 2026

Jayden approved promotion after reviewing staging. The guarded runtime-only
installer installed 0.5.33 into main Codex without warnings. Fresh status reports
`ok=true`, `recommendedAction=none`, matching source/runtime/loader hashes,
valid signature and ASAR integrity, and no pending transaction. Production
settings and the app bundle are unchanged. Evidence:
`output/production-install-0533.json`, `output/production-status-0533.json`.

The running main app was not interrupted. A restart is required to load the
new runtime; production visual verification after that restart is not claimed.
The source and staging verification below remains the acceptance evidence.

This dedicated worktree snapshots the tracked, uncommitted 0.5.32 baseline
from `workflow-footer-usage-flash`. Differences from Git HEAD include inherited
work. The original implementation phase was staging-only; the subsequent
approved production installation is recorded above.

## Behaviour

Workflow > Composer contains a native composer preview, Microphone, Model label
(Full name / Short name), Reasoning label (Full name / Compact), Composer width
(Default / Wide), and Reset this section. The requested attachment toggle,
usage placement row and setup footer are absent. Existing Usage preferences
and the actual attachment control are preserved.

The existing `hideComposerMicrophone` preference is displayed as a positive
Microphone switch. New optional schema-4 preferences are `composerModelLabel`
(`full`), `composerReasoningLabel` (`full`), and `composerWidth` (`default`). Both
normalisers validate the same enums. The existing trusted IPC and atomic write
path owns persistence, concurrent-write blocking, canonical reconciliation and
visible rollback. Section reset writes only these four Composer preferences.
These presentation choices do not change the selected model, reasoning effort,
permissions or request contents.

## Native evidence and ownership

Audited installed Codex 26.903.71938 / 8576:

- `app-primary-defe25a79fce.js`: composer structure and the model picker's
  `ModelPickerTriggerModelText` / `ModelPickerTriggerEffortLabel` leaves.
  Leaf selectors require the native intelligence/navigation trigger and one
  unambiguous composer owner; the label snapshots preserve React text updates.
- The preview copies the live native DOM after both editor and picker mount.
  Drafts, attachments, native IDs/references, drop targets and editable state
  are removed. The clone is inert and has an accessible summary. A sanitized
  exact-build native fallback supports entering Settings before composer mount.
  Partial React unmounts must never replace a complete cached example.
- Native `--thread-content-max-width` aligns message and composer columns.
  `thread-scroll-layout-97a811fea267.js` applies a Motion translation and exposes
  its absolute magnitude in `--thread-wide-block-inline-shift`. Wide subtracts
  twice this shift from available width, preserving native side-panel space.
  Resolve that variable on the native columns: resolving at the scroll owner
  evaluates the fallback before the descendant's Motion property exists.
  The scoped stylesheet and owned inline property are removed on reset/unmount;
  original inline presence/value/priority are restored.
- Settings rows, switches, menus and segmented controls reuse the existing
  audited Workflow primitives. The Workflow back button uses native ghost
  hover/focus tokens with a transparent resting state.

## Staging evidence

Staging root: `/private/tmp/codex-workflow-staging-uDKpBB`.
The existing guarded helper verifies bundle fingerprint, signature and exact
process birth identity before refreshing only its isolated runtime. Profile,
CODEX_HOME, settings, logs, updater stub and user-data remain isolated. Production
bundle/runtime/process are not modified. Each refresh retains a local runtime
and settings backup under `output/runtime-backup-*`.

Focused checks cover enum persistence, unrelated settings, reset boundaries,
sanitized/cold/partial-mount previews, native text updates, ambiguous targets,
remounts, width restoration, concurrent writes and rejected-save rollback.
The final `npm run check` passes all 198 tests (zero failures). Full run evidence
is in `output/check-final.log`; the focused main/preload/usage run passes 97 tests.

Visual evidence: `output/visual-evidence.json`, `output/width-evidence.json`,
`output/composer-{light,dark}-{1280,650}.png`, and
`output/thread-wide-fixed.png`. At a 1600px viewport with the native side panel
open, both columns measure 1008.5px in Wide versus 768px in Default. The Wide
left edge equals the visible scroll owner's left edge (275.5px); no clipping
under the sidebar is accepted. Both themes and widths exercise keyboard menus,
Escape/focus restoration, preview completeness and transparent/hover back states.
Native UI font size 16 (restored to 14 afterward) also fits the 650px window:
all controls remain within the content pane, with no horizontal overflow.
Reduced-motion rendering was checked in the same run. All four preferences
survive a staging restart, source and staged main/preload hashes match, and
section reset preserves unrelated settings. See `output/persistence-evidence.json`
and `output/composer-large-text-650.png`. The original System theme is restored.

Read-only production preflight reports the supported build, matching ASAR
integrity, valid signature, no pending transaction, and an intact source backup.
The status-derived reapply dry-run passed without warnings before promotion.
