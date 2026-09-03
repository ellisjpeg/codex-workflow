# Changelog

All notable changes to Codex Workflow are documented here.

## 0.5.10 - 2026-09-03

- Re-audited and guarded Codex Desktop `26.901.20858` build `7658` without changing the existing native DOM integration.
- Added a validated disposable-staging helper with separate app identity, process, user data, short socket-safe `CODEX_HOME`, Workflow state, and updater isolation.

## 0.5.9 - 2026-09-02

- After replacing ASAR and Info.plist, ad-hoc re-sign ChatGPT/Codex so macOS will launch the patched app.
- Keep a copy of the original Apple signature and restore it on uninstall.

## 0.5.8 - 2026-09-01

- Open Settings from the sidebar gear through Codex's native `Cmd+,` command, removing the profile-menu click race and synthetic pointer hover.

## 0.5.7 - 2026-09-01

- Kept the Workflow Update control out of the native titlebar flex layout and aligned its trailing inset with native sidebar actions.
- Applied verified feature releases through the external runtime before relaunching Codex, avoiding unnecessary app-bundle rebuilds and interrupted handoffs.
- Stopped the background release checker from attempting installations while Codex is open.

## 0.5.6 - 2026-09-01

- Retried guarded update-control discovery when the global titlebar mounts after the sidebar, without observing unrelated renderer mutations.

## 0.5.5 - 2026-09-01

- Restored Workflow Update in the current global titlebar layout with guarded host discovery, compact hover text, and remount recovery.
- Forced a fresh release fetch when the previously staged update is missing instead of trusting a stale ETag.
- Removed archive symlinks during release packaging so staged releases pass the updater's link-safety checks.

## 0.5.4 - 2026-08-31

- Added a Focused Interface option that moves the native Settings action to the sidebar Help slot and places Help & Updates in the account menu.
- Kept the native Help popover while aligning it to the account menu, adding Back navigation, and preserving Escape, outside-click, and account-button dismissal.
- Added pre-paint remount, exact restoration, alignment, overlap, dismissal, and persistence-rollback coverage.
- Limited update availability and background installation to verified staged GitHub Releases instead of local checkout version changes.
- Blocked update handoff while patch recovery is pending and made rejected stale clicks clear without quitting.

## 0.5.3 - 2026-08-31

- Made the Workflow Update control explicitly interactive inside the draggable titlebar.
- Added a forced-exit fallback, complete updater handoff logging, and explicit app-exit failures instead of silent cancellation.

## 0.5.2 - 2026-08-31

- Moved Workflow Update into the sidebar titlebar with the native hover-reveal motion.
- Added instant local source detection and five-minute conditional release checks.

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
