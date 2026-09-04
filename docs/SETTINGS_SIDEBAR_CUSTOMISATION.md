# Settings sidebar customisation — candidate evidence

## Scope and state

- Workflow > Interface > Customise settings sidebar exposes Customise/Done.
- `hiddenSettingsPages` is an additive optional schema-2 array, defaulting to `[]` in main, preload, installer and staging. Existing Boolean representations and legacy migration are unchanged.
- Both normalisers accept only the first 100 entries, deduplicate valid lowercase route slugs of at most 80 characters, and exclude `workflow`. Unknown slugs are retained for a page that returns in a later mount; they never create synthetic destinations.
- Writes use the existing trusted IPC, one-write-at-a-time guard, canonical response, exclusive owner-only temporary file, fsync and atomic rename. Rejection restores controls and navigation together.
- Edit/disclosure state is transient. Entering edit mode expands a non-empty Hidden group. Closing Settings exits editing; restart keeps choices but starts collapsed.

## Native evidence

Source inspected read-only from installed Codex 26.901.31953 / 7868:

- `webview/assets/settings-page-5e41756e36b2.js`: grouped Settings navigation, its single `overflow-y-auto` owner, and native ArrowUp/ArrowDown focus-and-activate behavior. Search replaces groups with independent `data-list-navigation-item` results; its search index uses native section data, not rendered row visibility.
- `webview/assets/app-primary-37ff25fd4643.js`, exports `dh` (`wJ`) and `fh` (`TJ`): native sidebar item and section primitives. Hidden copies the section stack, header padding (`pe-0.5 ps-2`), tertiary header typography and row spacing.
- Installed Minus/Plus/Chevron icon assets: 24-unit Lucide path vocabulary. Installed `app-initial-5b0a474bff5e.css`: danger-solid, white, native icon sizing, focus-ring and hover utilities.
- The existing Workflow Customize action supplies the action-button class vocabulary. Generated design directions are not implementation authority.

The production UI was not automated. Staging was blocked at sign-in. The user subsequently requested source inspection and automated tests with manual UI review instead. Native-looking composition, focus-ring clipping, hit targets, and exact geometry remain unverified until that review.

## Ownership and reversal

- Only enabled native `button[data-settings-panel-slug]` destinations inside the verified Settings scroll owner are hideable. Disabled entries, external browser links and plugin-extension rows without stable native page slugs are untouched.
- Original React nodes never move or get deleted. Owned proxy rows relay activation to the original button. Native routes and feature data remain native-owned.
- Each owned original retains its display value/priority and ARIA-hidden state. Removal of ownership restores those values, including absent/empty style attributes and original style spelling when no unrelated style changed.
- Editing replaces normal visible rows with native-class proxies at the same sibling position; separate absolutely positioned action buttons do not participate in row layout. There are no nested interactive controls. Native section containers and footer never move.
- Hidden proxies are inserted after the last normal page section, within the scroller and before following footer content. Restoration returns the original node to its unchanged normal position. Hidden rows can be visited without persisting a restore.
- Search remains native and unfiltered. A search-result activation releases the Workflow panel without writing preferences. Workflow is retained through an in-place search remount.
- Existing scoped Settings observation owns synchronisation. No new runtime observer, interval, or document-wide scan is added. Duplicate route identities or ambiguous scroll owners release sidebar ownership rather than guessing.
- Arrow navigation skips hidden originals and collapsed proxies. Tab/Enter/Space use real buttons. Collapse moves focus out of hidden content. No animation is added, including under reduced motion.

## Automated proof

`npm run check` includes focused main/preload fixtures for canonical defaults and validation, actual disk round-trip/permissions, hide/restore, Workflow exclusion, content retention, IPC rejection/serialization, native search-result activation, empty/non-empty disclosure, native remounts, clone sanitation, keyboard focus, container/order preservation, and real MutationObserver settling.

Fixture layout assertions establish DOM order and out-of-flow controls, not pixel geometry. JSDOM does not prove live rendering, native React behavior, screen-reader output, or production performance.

## Manual review gate

On the audited build, after a separate guarded installation in a quiet window:

1. Compare General, Appearance and Workflow at wide/narrow widths, light/dark themes and increased zoom. Confirm labels, row height, right-edge controls and footer alignment.
2. Capture normal and edit states; check every eligible page has a red minus except Workflow. Verify pointer hover, Tab focus, Enter/Space activation and ArrowUp/ArrowDown selection.
3. Hide the currently open native page while editing. Its content must remain. Verify Hidden appears immediately below the final section and scrolls normally above the footer.
4. Capture expanded and collapsed Hidden states. Check the far-right chevron, clipping and focus movement. Re-enter editing and restore with plus; the empty section must disappear.
5. With editing off, visit a hidden page through the disclosure and then native search. Neither visit restores its normal row. Clear search, close/reopen Settings and relaunch; choices must survive.
6. Confirm native content, external links, disabled pages and plugin-extension rows remain functional; inspect accessible names/IDs and reduced-motion behavior.

No live feature-state screenshots or production-install claim accompanies this source candidate.
