# Changelog

All notable changes to Codex Workflow are documented here.

## 0.5.43 - 2026-09-14

- Install Workflow directly into the existing Codex app through public setup, without creating or opening Codex Workflow Staging. Preserve source checks, exact-build preflight, explicit confirmation, backups, recovery and verified relaunch.
- Keep staging as an explicit developer command and exclude its helpers from updater assets.
- Shorten the GitHub README, retain the original banner, add matching illustrations and move detailed operating notes into the installation guide.
- State that pull requests are not accepted, with bug reports, feature ideas and personal forks still welcome.

## 0.5.42 - Workflow Alpha 1

- Publish Workflow Alpha 1 as a regular Latest release, with tag-pinned source installation and compatible updates through the existing release feed. Alpha describes the unfinished product scope.
- Create draft releases for review rather than publishing automatically on tag push. Set prerelease classification from validated SemVer and never mark a draft Latest.
- Include complete Lucide/Feather icon notices in source and updater assets, with archive-content regression coverage.
- Obtain native glyphs from the user's audited Codex installation at runtime instead of bundling captured artwork. Build the complete cold-entry Composer preview from Workflow-owned structure, preserving its native appearance and controls.
- Preserve macOS extended signature attributes in durable backups and restore a valid local ad-hoc signature during recovery/removal, including older snapshots with missing metadata.

### Changes carried forward from the audited 0.5.42 candidate

- Preserve the complete 0.5.41 usage-indicators feature set while avoiding discarded switch construction for dropdowns and sliders, sharing the native slider class, and removing unreachable internal code.
- Validate release versions strictly and compare prereleases correctly in the updater and update UI. Reject malformed remote tags before download or extraction.
- Verify the requested installed version and absence of blocking/error state before relaunching after an update; successful helper exits alone are not accepted, and failed verification permits retry.
- Align the Node.js requirement with the locked test dependencies and enforce it during clean installation, including minimum-version CI coverage.
- Stage an explicit updater payload with locked production dependencies and preserved licence notices, without pruning the development installation. Keep deferred policy modules and historical regression fixtures in source.
- Correct the build-8881 documentation link and document the actual IPC/network boundary, source map and release verification limits.

## 0.5.41 - Usage-indicators baseline

- Add usage-window selection, remaining/reset presentation, context usage, configurable low-usage alerts and section reset, retaining existing placement and settings migrations.

## 0.5.40 - 2026-09-12

- Restore the Conversation width track with the current native blue token on Codex build 8881.
- Add the native Account destination to Settings navigation ordering and visibility controls.

## 0.5.39 - 2026-09-12

- Restore native dropdown padding, toolbar triggers and checkmarks after the Codex 26.908.40834 / 8881 update.
- Update the native usage and sidebar-width bridges, switch thumb colours, sidebar icon sizing and Composer preview for that build.
- Preserve animated model labels in the live composer while keeping the preview readable.
- Correct the search fallback background and make the observer regression test wait for actual animation frames.
- Verify the combined fixes with 204 checks and isolated staging visual, keyboard, zoom and restart checks.

## 0.5.35 - 2026-09-12

- Add functional Conversation settings for message width, spacing, user-message style, tool activity and timestamps, with an interactive preview and section reset.
- Keep plain-text prompts on the user side, put preview timestamps below tool details, and smoothly reveal copy/edit controls beside user timestamps with reduced-motion support.
- Add Composer previews, compact model and reasoning labels, and native conversation/composer width controls.
- Extend sidebar shortcuts and footer placement, improve remaining-usage presentation, and preserve navigation choices through schema-4 migration.
- Keep staging Dock launches isolated from production with their own Chromium user-data path.
- Verify the integrated update with 203 checks and focused live staging checks.

## 0.5.24 - 2026-09-11

- Combine the Workflow home, Sidebar & navigation, Composer and Usage & indicators in one customisation experience.
- Support Codex Desktop 26.903.71938 / build 8576 with audited native usage and sidebar-width bindings.
- Show native remaining allowance in the toolbar or composer, with in-app placement controls and unavailable/reset handling.
- Retain microphone visibility and exact-model Web Astra Pro labels without changing model selection, effort or permissions.
- Keep guarded release updates available from Workflow settings and package only Workflow runtime/installer files.
- Migrate existing visibility choices into the integrated navigation controls without overwriting newer preferences.
- Keep pointer capture on the stationary navigation card so dragging rows does not cancel at the first swap.
- Remove the Navigation items helper text and its spacing on all three tabs.

## 0.5.23 - 2026-09-11

- Match native Codex switches with blue checked tracks across the master, changed-only filter and recent-chat controls, including after saves and rollback.
- Mark decorative switch tracks as hidden from accessibility tools, matching native controls.

## 0.5.22 - 2026-09-11

- Correct account-menu sizing to follow the measured visible sidebar width, replacing the mistaken fixed-width change.

## 0.5.21 - 2026-09-11

- Keep the account menu at its native default width while resizing the sidebar; disabling Workflow restores native sizing.

## 0.5.20 - 2026-09-11

- Add Sidebar & navigation to the pared-back Workflow homepage, using native settings controls.
- Persist navigation ordering and visibility, keep New chat fixed, and hide the entire Recents section when requested.
- Preview pointer reordering with native sortable timings, keyboard support, cancellation and failed-save rollback.
- Read and set the actual native sidebar width through a bounded, main-frame-only IPC bridge, with an inline px unit.

## 0.5.19 - 2026-09-05

- Guard Codex Desktop `26.901.41600` build `7982` after comparing its bootstrap, preload, settings routes, DOM contracts, CSS, and ASAR metadata with build `7868`.
- Preserve the complete 0.5.18 runtime and settings schema; no selector, observer, timer, IPC, signing, or integrity guard changes were needed.
- Add current-build acceptance and previous/adjacent-build rejection proof. Exact-build live staging remains pending under the recorded ownership gate.

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
