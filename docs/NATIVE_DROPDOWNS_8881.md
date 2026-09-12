# Native dropdowns and update audit, Workflow 0.5.39

Candidate: `workflow-native-dropdowns`, branch `fix/native-dropdowns-20260912`.
The baseline is the complete uncommitted 0.5.38 composer-preview snapshot,
including 0.5.36 compatibility/toggle fixes and 0.5.37 sidebar icons. Original
worktrees are unchanged. Jayden approved committing, publishing and installing
this combined candidate after reviewing staging.

## Cause and change

Codex 26.908.40834 / 8881 renamed menu padding utilities to `--app-menu-*`.
Workflow retained the old utility classes, leaving its rows without padding.
The shared menu now uses the current native menu item primitive, minimum
height, nonshrinking rows, content gap and 16px checkmark. The trigger uses
native `button-toolbar`, `rounded-button-toolbar` and `text-sm` classes.
All callers retain their settings keys, canonical IPC, keyboard handlers and
menu disposal. No new dependencies, privileges or observers were added.

Evidence: live General > Send shortcut and Appearance > UI font, plus installed
`app-initial-9b95fa538c62.js` and `button-6325b3939f12.js`. Both native and fixed
rows measure 28.5703125px with 5px vertical / 8px horizontal padding. Menus use
4px outer padding, and two choices measure 65.140625px total. Triggers are 28px.
The current theme controls corner radii, colours and foregrounds.

## Design-bible audit

- Reviewed main and renderer defaults/normalisation, atomic settings writes,
  sender validation, save rollback, native navigation restoration, clone
  sanitation, scoped observers, composer/conversation ownership, usage bridge,
  all shared menu callers, and the complete pending integration diff.
- All 26 referenced CSS module classes exist in the installed build. A scan of
  literal class assignments found one additional obsolete utility in the
  search fallback. It now uses native Settings search's
  `bg-background-secondary-soft-alpha`; the normal native clone is unchanged.
- A pre-existing Web Astra fixture occasionally counted a delayed startup
  observer pass as an infinite loop under suite load. It now waits six actual
  animation frames instead of assuming 100ms contains those frames. The exact
  no-additional-calls assertion and all remount/reversal assertions remain.
- Loader, installer, updater and persisted schema are unchanged from the
  integrated baseline. Guarded checks cover identity, version/build, integrity,
  recovery, restore, canonical settings and trusted bridge boundaries.
- No further confirmed update regression was found in the inspected paths.
  This is not a claim that every product state or future build is verified.

## Verification

The new dropdown regression fails on the old trigger/classes and passes with
the fix. It covers the fallback search token, native spacing, keyboard focus,
ArrowDown, rejected-save rollback and Escape/ARIA cleanup.
Final `npm run check`: 204 passed, zero failures/skips. The exact-build guarded
reapply dry-run passes without warnings or a version override. `git diff --check`
passes. Evidence: `output/check-final.log` and `output/dry-run.json`.

Staging root: `/private/tmp/codex-workflow-staging-uDKpBB`; localhost DevTools
49258; final candidate launch PID 67405. The guarded refresh verifies bundle
fingerprint/signature and keeps isolated user data, settings and runtime.
Both final runtime hashes match source. Compact reasoning survives restart.

Live checks cover light/dark, 1280px and native half-screen 736px widths,
110% UI zoom, selection, saved preference, Escape/Tab focus, native-page return, one owned
nav/panel and no duplicate owned IDs. Composer, Conversation, Usage and Add
shortcut menus all render with native row spacing; the four-row action menu
measures 122.28125px. Screenshots and extracted class evidence are in `output/`.
Original Full name preference, dark theme and 100% zoom are restored. Staging
is back at 1280px with Composer open for review.

Limits: live rejected-disk writes are tested in fixtures, not injected into the
running app. This clean staging profile has no real conversations, so existing
conversation-content behavior relies on its regression fixtures and prior
feature evidence. Production promotion uses the guarded runtime-only installer;
the running app loads the new runtime on its next restart. Any production
restart must wait for a quiet window so active tasks are not interrupted.
