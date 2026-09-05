# Changelog

All notable changes to Codex Workflow are documented here.

## 0.5.18 - 2026-09-05

- Collapse Hidden when sidebar editing finishes, without restoring its pages.
- Add scoped, preference-derived visibility CSS before update-status IPC to cover native inline-style resets, retained-DOM reveals and transitional layout before observer-owned controls mount.
- Document the remaining cold settings-read and live visual verification boundaries in the design bible and sidebar evidence.

## 0.5.17 - 2026-09-05

- Hide empty native Settings sections when all their destinations are hidden; restore sections together with their pages.
- Apply saved sidebar visibility before paint on Settings mounts and remounts using the existing observers.
- Place Focused Interface's Customise action beside its switch.
- Add a persistent red Revert action that resets only hidden-page choices, with write serialization and rollback.

## 0.5.16 - 2026-09-05

- Match the Hidden chevron to the muted section heading.
- Reduce hide/restore circles to 16px, retaining 24px targets inset by native row padding to avoid the scrollbar.
- Preserve the sidebar viewport when hiding or restoring a page, without undoing user scrolling during persistence.

## 0.5.15 - 2026-09-05

- Add Customise/Done sidebar editing with hide/restore controls and a non-sticky Hidden disclosure.
- Preserve native routes, current content, search results, and feature state; Workflow always remains reachable.
- Persist hidden-page choices through canonical atomic settings writes with optimistic rollback. Live visual review remains pending.

## 0.5.14 - 2026-09-04

- Preserve an unchanged loaded updater LaunchAgent so its installer does not terminate its own repair process.
- Require the installed Workflow version and loader/runtime/source hashes to match before automatic repair relaunches Codex.
- Document bounded deployment after the failed September 4 one-shot repair attempt.

## 0.5.13 - 2026-09-04

- Re-audited and guarded Codex Desktop `26.901.31953` build `7868` while preserving the existing Workflow UI and composer microphone preference.
- Made post-update repair failures visible as one deduplicated waiting state and notification when no exact-build verified release exists, without repeated prompts or background log noise.

## 0.5.12 - 2026-09-04

- Added an independent Interface preference that hides the idle composer microphone control while preserving active dictation controls and native layout reflow.

## 0.5.11 - 2026-09-03

- Added one bounded `npm run setup` flow with concise output, `y`/`yes` or agent approval, one isolated staging launch, signal-safe cleanup, one guarded install, and one relaunch.
- Replaced locale-formatted staging process identity with canonical birth tokens, persisted launch ownership before DevTools readiness, and covered terminal interruption cleanup.
- Triggered release discovery at startup and app focus while retaining ETags, a five-minute floor, and exponential failure backoff capped at one hour.
- Added release compatibility manifests and opt-in, exact-build automatic repair after Codex replaces the app, reusing the existing journal, backup, signing, verification, and recovery guards.

## 0.5.10 - 2026-09-03

- Re-audited and guarded Codex Desktop `26.901.20858` build `7658` without changing the existing native DOM integration.
- Added a validated disposable-staging helper with separate app identity, process, user data, short socket-safe `CODEX_HOME`, Workflow state, and updater isolation.
- Hardened staging with fail-closed updates, immutable clone builds, an isolated allowlisted environment, exact loopback port/process ownership, pre-launch fingerprint verification, symlink revalidation, and backup-preserving lifecycle checks.

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
