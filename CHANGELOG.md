# Changelog

All notable changes to Codex Workflow are documented here.

## 0.5.1 - 2026-08-31

- Started account-menu discovery on native pointer and keyboard open events so pet and friend-invite rows are hidden before the first portal paint.
- Added regression coverage for the native pointerdown event order.

## 0.5.0 - 2026-08-31

- Added a native responsive Workflow Update pill to the conversation toolbar.
- Added one-click quit, guarded reapply, and relaunch without a confirmation dialog.
- Added a local background agent for verified GitHub Release updates while ChatGPT is closed.
- Added release packaging with GitHub asset-digest and archive-path verification.

## 0.4.4 - 2026-08-31

- Added a Focused Interface preference that hides Invite a friend before the account menu paints.
- Prevented hidden account-menu controls from appearing for one frame as the menu opens.

## 0.4.3 - 2026-08-31

- Generalized the runtime location for the current macOS user.
- Added owner-only permissions for newly created state files.
- Updated the ASAR tooling to its current compatible release.
- Corrected account-menu recognition when native Settings shows its keyboard shortcut.
- Covered account-menu rows populated after their portal first mounts.
- Added Focused Interface controls for Pull requests and pet-menu visibility.
- Added scoped sidebar/settings observers and remount recovery.
- Added guarded installation, rollback, recovery, status, and uninstall flows.

## 0.2.2 - 2026-08-31

- Added the initial Workflow settings integration and sidebar visibility preference.
