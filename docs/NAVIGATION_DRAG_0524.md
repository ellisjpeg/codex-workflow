# Navigation drag correction, 0.5.24

Baseline: the local 0.5.23 candidate in `workflow-starter-screen`, including its
uncommitted changes and parked renderer fixture, copied into the dedicated
`fix/navigation-drag-0.5.24` worktree. The original checkout is unchanged.

Real Chromium mouse input reproduced the first-swap failure in isolated staging
Codex 26.901.41600 / 7982: moving the row with insertBefore lost capture on its
handle, and lostpointercapture cancelled the drag and restored the old order.
Capture and drag listeners now belong to the stationary card. Existing Escape,
pointer cancellation, drop animation, keyboard controls and save rollback remain.
The existing regression now models capture loss when a captured descendant moves.

Removed the helper text on all three Navigation items tabs, including its pb-4
spacing. The existing native section header directly precedes the card; no new
spacing values or CSS were introduced.

Validation: all 157 source checks passed. Real staging input moved Plugins across
two rows without lost capture until release, and the saved JSON matched the drop.
Keyboard restored the original order. All three tabs place the card directly after
the section header and have no horizontal card overflow. Dark screenshot inspected
at `output/drag-fixed.png`. Existing reduced-motion and failed-save tests passed.
Staging refresh validated identity, signature and ASAR integrity; runtime backup is
under `output/sidebar-navigation/`. Staging root remains
`/private/tmp/codex-workflow-staging-e8WpMM`, localhost DevTools port 9443.

Production was neither installed nor restarted. Its version 26.903.71938 / 8576
differs from this candidate's audited target. Fresh status reports inspect, and
the reapply dry-run refuses that version. Compatibility audit and explicit
production installation authorization remain separate gates. No new light-theme,
narrow-width or restart-persistence matrix was run for this focused correction.
