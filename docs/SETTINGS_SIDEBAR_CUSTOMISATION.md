# Settings sidebar customisation — candidate evidence

## Scope and state

- Workflow > Interface > Customise settings sidebar exposes Customise/Done.
- Revert remains beside Customise/Done, disabled when nothing is hidden or a write is pending. It clears only `hiddenSettingsPages`, including retained unknown slugs, without changing features, the current page or edit mode. No confirmation is needed for restoring navigation visibility.
- Focused Interface's Customise disclosure now shares the native control group beside its master switch instead of occupying a separate row.
- `hiddenSettingsPages` is an additive optional schema-2 array, defaulting to `[]` in main, preload, installer and staging. Existing Boolean representations and legacy migration are unchanged.
- Both normalisers accept only the first 100 entries, deduplicate valid lowercase route slugs of at most 80 characters, and exclude `workflow`. Unknown slugs are retained for a page that returns in a later mount; they never create synthetic destinations.
- Writes use the existing trusted IPC, one-write-at-a-time guard, canonical response, exclusive owner-only temporary file, fsync and atomic rename. Rejection restores controls and navigation together.
- Edit/disclosure state is transient. Entering edit mode expands a non-empty Hidden group; Done collapses it without writing preferences or changing the current page. Closing Settings exits editing; restart keeps choices but starts collapsed.

## Native evidence

Source inspected read-only from installed Codex 26.901.31953 / 7868:

- `webview/assets/settings-page-5e41756e36b2.js`: grouped Settings navigation, its single `overflow-y-auto` owner, and native ArrowUp/ArrowDown focus-and-activate behavior. Search replaces groups with independent `data-list-navigation-item` results; its search index uses native section data, not rendered row visibility.
- `webview/assets/app-primary-37ff25fd4643.js`, exports `dh` (`wJ`) and `fh` (`TJ`): native sidebar item and section primitives. Hidden copies the section stack, header padding (`pe-0.5 ps-2`), tertiary header typography and row spacing.
- Installed Minus/Plus/Chevron icon assets: 24-unit Lucide path vocabulary. Installed `app-initial-5b0a474bff5e.css`: danger-solid, white, native icon sizing, focus-ring and hover utilities.
- The existing Workflow Customize action supplies the action-button class vocabulary. Generated design directions are not implementation authority.
- `webview/assets/app-initial-caa927532ffb.js`: Revert uses the native button `danger` variant (`bg-chart-red/10 enabled:hover:bg-chart-red/20 text-chart-red`), retaining the existing size, disabled and keyboard-focus classes.

The production UI was not automated. Staging was blocked at sign-in. The user subsequently requested source inspection and automated tests with manual UI review instead. The user's final review is recorded below; it is not automated geometry or accessibility proof.

Manual feedback on installed 0.5.15 reported an unmuted chevron, oversized circles at the scrollbar and a scroll-to-bottom on hide. The 0.5.16 source fixes use the heading's `text-tertiary opacity-75`, 16px circles within 24px targets inset by `--padding-row-x`, and scroll-preserving ownership focus transfers. Hide/restore preserves the immediate viewport without overriding later user scrolling while persistence finishes. The installed CSS confirms the tokens, not the final geometry.

## Ownership and reversal

- Only enabled native `button[data-settings-panel-slug]` destinations inside the verified Settings scroll owner are hideable. Disabled entries, external browser links and plugin-extension rows without stable native page slugs are untouched.
- Original React nodes never move or get deleted. Owned proxy rows relay activation to the original button. Native routes and feature data remain native-owned.
- Each owned original retains its display value/priority and ARIA-hidden state. Removal of ownership restores those values, including absent/empty style attributes and original style spelling when no unrelated style changed.
- Editing replaces normal visible rows with native-class proxies at the same sibling position; separate absolutely positioned action buttons do not participate in row layout. There are no nested interactive controls. Native section containers and footer never move.
- A direct native section inside the verified scroller disappears only when its header/rows structure matches `TJ` and every row is an owned hidden destination. Workflow, disabled entries, external links, extension rows, header actions and unknown structures keep their section visible. The section's display/priority/ARIA snapshot is restored when any destination returns or ownership ends; no empty flex gap remains.
- Hidden proxies are inserted after the last normal page section, within the scroller and before following footer content. Restoration returns the original node to its unchanged normal position. Hidden rows can be visited without persisting a restore.
- Search remains native and unfiltered. A search-result activation releases the Workflow panel without writing preferences. Workflow is retained through an in-place search remount.
- Existing discovery and scoped Settings observers own synchronisation; no new observer or interval is added. With saved hidden pages, Settings discovery and navigation mutations synchronise immediately before paint, rather than waiting another animation frame. This follows the design bible's deferred account-menu fix. Other work remains frame-coalesced. Duplicate route identities or ambiguous scroll owners release sidebar ownership rather than guessing.
- Arrow navigation skips hidden originals and collapsed proxies. Tab/Enter/Space use real buttons. Collapse moves focus out of hidden content. No animation is added, including under reduced motion.

## Automated proof

### Follow-up flash investigation (0.5.18 candidate)

The 0.5.17 immediate observer path was insufficient: it still required child-list delivery and valid geometry, and startup waited for update-status IPC. New regressions failed on 0.5.17 for native inline-display resets without child mutations, retained-owner reveal, zero-sized initial navigation and delayed update-status IPC. Warm Settings visits in production logs did not create fresh preloads, so initial settings IPC alone cannot explain the user's repeated flash. The precise live frame path is not captured.

Installed `app-initial-caa927532ffb.js` confirms React's native reveal restores inline display from its own props, and `mYa`/`fZa` animate left-panel geometry. The exact Settings nav/row/section selectors are from `settings-page-5e41756e36b2.js` and `TJ`; `webview/index.html` allows inline styles. One stylesheet now applies normalized hidden-page choices immediately after settings load, before update-status IPC. Native standard/floating sidebar owners and Settings class/ARIA identity scope it; dialogs, menus, palettes, search, disabled rows, Workflow and unowned section content are excluded.

The stylesheet controls presentation only; full mounting keeps its existing geometry and ambiguity guards. Native visibility is measured with only that nav temporarily exempted, restored in `finally`, so native CSS hiding is not mistaken for patch ownership. Canonical writes, rollback and Revert update/remove the stylesheet. Existing observers still own proxies and exact restoration; no new observer, interval, privileged bridge or dependency is introduced. Initial asynchronous settings read remains a prerequisite, not a claimed cold-start first-frame guarantee. The parent design bible records this additional method for future implementations.

`npm run check` includes focused main/preload fixtures for canonical defaults and validation, actual disk round-trip/permissions, hide/restore, Workflow exclusion, content retention, IPC rejection/serialization, native search-result activation, empty/non-empty disclosure, native remounts, clone sanitation, keyboard focus, container/order preservation, and real MutationObserver settling.

Regression fixtures also check muted disclosure styling, smaller circles with native inset and label clearance, and hide/restore scroll preservation including user scrolling during a pending write. The scroll fixture models focus-induced scrolling; it is not browser layout proof.

The 0.5.17 fixtures cover empty-section restoration, unowned-row exclusions, Revert outside/inside editing, narrow persistence and rejected-write rollback, adjacent Focused Interface controls, and delayed Settings/whole-shell/row remounts before the next frame with real mutation observers. Observer teardown is explicit to avoid callbacks after JSDOM closes. First-paint suppression is scheduling evidence, not a captured production frame.

Fixture layout assertions establish DOM order and out-of-flow controls, not pixel geometry. JSDOM does not prove live rendering, native React behavior, screen-reader output, or production performance.

## Manual review gate

On the audited build, after a separate guarded installation in a quiet window:

1. Compare General, Appearance and Workflow at wide/narrow widths, light/dark themes and increased zoom. Confirm labels, row height, right-edge controls and footer alignment.
2. Capture normal and edit states; check every eligible page has a red minus except Workflow. Verify pointer hover, Tab focus, Enter/Space activation and ArrowUp/ArrowDown selection.
3. Hide the currently open native page while editing. Its content must remain. Verify Hidden appears immediately below the final section and scrolls normally above the footer.
4. Capture expanded and collapsed Hidden states. Check the far-right chevron, clipping and focus movement. Re-enter editing and restore with plus; the empty section must disappear.
5. With editing off, visit a hidden page through the disclosure and then native search. Neither visit restores its normal row. Clear search, close/reopen Settings and relaunch; choices must survive.
6. Confirm native content, external links, disabled pages and plugin-extension rows remain functional; inspect accessible names/IDs and reduced-motion behavior.
7. Hide the final page in Code/Coding; its header and gap must disappear. Restore one page and verify the original section returns. Reopen Settings repeatedly and check for a flash of hidden pages or headers.
8. Verify Focused Interface's adjacent Customise control and the red Revert action at narrow widths. Revert both outside and inside editing; only sidebar choices reset, current content remains and no empty Hidden section survives.

## Installed result and user approval — 2026-09-05

- `npm run check` passed 143/143 tests. The guarded runtime-only dry-run and installation passed; post-restart status confirmed Workflow 0.5.18, matching runtime/source hashes, no pending transaction, unchanged settings and app integrity. Runtime and preload startup were confirmed in logs.
- After the separately approved installation and single graceful restart, the user passed visual review: more than 20 repeated attempts were fine, with one possible flash they could not confidently confirm. This is accepted manual review, not proof that an intermittent flash is impossible; retain that uncertainty if it recurs.
- The user's final approval satisfies their requested commit/push gate. No new live feature-state screenshots were captured; staging sign-in remained blocked, and production UI was not automated. Cold-renderer visibility before the asynchronous settings response and exhaustive geometry/accessibility checks remain unproven.
