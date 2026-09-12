# Sidebar & navigation, 11 September 2026

## Workflow and Profile shortcuts, 0.5.29

Both App sidebar > Add shortcut and Account menu > Footer shortcut offer
Settings, Usage, What's New, Workflow and Profile. General is removed from
both catalogues; existing General selections migrate to Settings with deduped
membership and preserved visibility. The schema 4 object shape is unchanged.
Workflow opens its overview through the existing native Settings shell and
bounded discovery lifecycle; Profile uses the native `/settings/profile` route.
Both normalisers accept the new IDs and continue using atomic persistence.

Native evidence: installed Codex 26.903.71938 / 8576, settings-page-10f72f72ae31.js,
and live staging Profile/Workflow navigation. Profile uses the exact native
20px profile glyph; Workflow reuses its settings glyph.
The live chat header measured equal 6px button gaps, but the usage text button
had 8px horizontal padding. Its existing native `px-1` utility now gives 4px;
Share retains 8px padding and its exact position, and all 6px gaps are unchanged.
Composer padding is unchanged.

Verification: all 189 `npm run check` tests pass on the full rerun. The first
run had one unrelated Web Astra observer timing failure; its isolated rerun
and subsequent full run both passed without changing that code or test.
Regression checks cover both pickers, migration/deduplication, persistence,
failed-save rollback, native Profile routing and delayed Workflow shell mount.
Staging was restarted through `output/refresh-staging.mjs` at
`/private/tmp/codex-workflow-staging-uDKpBB`, PID 93795, DevTools 9444, with the
manifest's isolated bundle identity, user data and Workflow runtime. Live clicks
verified all four sidebar/footer destinations, General's removal, and 0.5.29.
Dark/light and 100%/110% zoom were visually checked; System theme and 100% zoom
were restored. A separate narrow-window/RTL check was not performed.
The guarded runtime-only dry-run passed. The explicitly authorised runtime-only
installer then installed 0.5.29 with no warnings. Fresh status is healthy with
source/loader/runtime current, valid signature, matching integrity, no pending
transaction and the source backup present. Production settings and bundle
integrity are unchanged. Evidence is in `output/shortcut-0529-{install,after-install}.json`.
Official Codex stays running; the user will restart it to load the new runtime.

## Shortcuts and footer action, staging 0.5.28

Production promotion: after Jayden explicitly approved installation, the guarded
runtime-only installer installed 0.5.28 with no warnings. Fresh status reports
ok=true, source/loader/runtime current, valid signature and ASAR integrity, no
pending transaction and recommendedAction=none. Existing production settings
were preserved. Codex was not interrupted; the installed runtime requires the
user's next restart before the running app uses it. Evidence: local
`output/promotion-before.json` and `output/promotion-after.json`.

Settings, Usage, What's New and General share the App sidebar's existing order
and visibility list. Add shortcut offers only absent entries. Removing an entry
also clears its hidden state, and schema 4 preserves removal across restart.
Older preferences retain their existing Settings shortcut. Both normalisers
validate membership; saves use the existing atomic writer and optimistic rollback.
Shortcut rows place delete before the rightmost eye, keeping built-in eye padding.

Account menu has a separate Footer shortcut card: “Choose the shortcut beside
your account.” Its native-style dropdown selects one of the same four actions,
independently of sidebar membership. The default is What's New. The footer uses
a scrubbed native button clone; its React-owned help trigger remains available
to open the original news menu, but is hidden while the clone owns presentation.
Disabling customisations or remounting restores the native trigger.

The news popup retains native contents and behaviour. Its visible owner controls
expanded state; repeat click sends native Escape instead of reopening. A scoped
capture handler keeps the owner clickable through the native modal pointer guard.
Sidebar popups align below their row and flip when needed; footer popups align
above, using measured native sidebar-row width. Position styles, observers and
pointer handling are released on dismissal or unmount. No new animation or colour
system is introduced. Icons come from installed Settings, Gauge, CircleHelp,
Plus and Trash2 assets. Controls share the existing usage selector/menu primitives.

Verification on 26.903.71938 / 8576:

- Focused main/renderer/usage checks: 79 passed. Full check: 187/188 passed;
  the unrelated Web Astra composer observer's 100ms timing assertion failed
  under concurrent load. Its unchanged file passed both tests on isolated rerun.
- Regression checks cover migration, atomic restart persistence, membership,
  action order, menu keyboard controls, repeat toggle, popup reposition/cleanup,
  footer independence, routing and rejected-save rollback.
- Staging live: repeat click opens/closes native news; footer Usage survives
  restart and opens native Usage. Navigation and footer cards were visually
  checked in light/dark and at 1200px/920px window widths. System theme restored.
- Native menu accessibility contents were verified; computer-use screenshots
  are unavailable while native menus are open. Popup geometry is covered by
  fixtures, but pixel inspection of the open popup remains a user-review gate.
- Dry-run passed with no warnings; signature and ASAR integrity remain valid.
  Production remains 0.5.27; candidate status correctly reports runtime drift.
  Only `/private/tmp/codex-workflow-staging-uDKpBB` received the candidate runtime.

This supersedes the earlier deferral of general shortcut creation below.

## Native segmented states, 0.5.27

Supersedes the two incorrect interpretations below. The user wants native hover
and selection feedback, not their removal. Current installed
`segmented-toggle-9de0b8eb86ad.js` defaults to `segmentedSelected` and `ghost`;
`app-initial-a9514281e192.js` defines their theme-aware background/hover tokens.
The three navigation buttons now use those exact colour variants, preserving
their geometry, keyboard focus and aria-pressed. Regression checks cover every
tab becoming selected and retaining the appropriate hover class. Restarted
staging 0.5.27 visually shows selected App sidebar alongside hovered inactive
Account menu in both dark and light themes; pointer and keyboard selection work.

## Selected background and version footer, 0.5.26

The user's follow-up screenshot identified the selected pill, which 0.5.25
preserved. Removed that background too, keeping selected text and aria-pressed.
Home and navigation now show the installed runtime version opposite Reset,
using existing update-status IPC and native secondary text. Save/error messages
remain separate. Restarted staging and visually checked the label and tabs in
light and dark appearance; the version reads v0.5.26 in both.

## Hover correction, 0.5.25

Removed the inactive navigation tabs' explicit `hover:bg-surface-secondary`.
Selected backgrounds and keyboard focus rings remain intact. All three tabs
are covered across selection changes by the renderer regression. This follows
the design bible's native-state requirement; the installed 26.903.71938 / 8576
segmented controls and native General/Appearance pages were inspected.
All 185 checks passed. The isolated staging app at
`/private/tmp/codex-workflow-staging-uDKpBB` was restarted and visually checked
in dark and light appearance, including an inactive tab under the pointer,
tab switching, keyboard focus and native-page return. System theme was restored.
Production received the same external runtime without a restart; Jayden owns
the production restart and visual check.

Continuation of the pared-back starter screen. The three supplied images are
visual references; the user's written exclusions and the installed native UI
take precedence. General shortcut creation is deferred for a later brainstorm.

## Acceptance

- Workflow home remains in native Settings, with Sidebar & navigation opening
  a real child page. Task previews and setup-scope copy are absent.
- App sidebar, Settings navigation and Account menu use the audited native
  segmented control. Cards, rows, switches, inputs and icon buttons reuse native
  classes, assets and tokens. New chat is fixed and cannot be hidden.
- Pointer reordering previews positions, supports cancellation and persists once
  on release. Keyboard arrows reorder. Reduced motion skips interpolated motion.
- Visibility and ordering survive native remounts; hiding Recents includes its
  heading and children. Disabling customisations removes the scoped rules.
- The numeric width is the native sidebar store's current value, including after
  manual resizing. Native width writes accept only integers from 240 to 520.
- Only the isolated staging bundle is refreshed and signed. Production is not
  installed, restarted or broadened to an unaudited Codex build.

## Source and native evidence

Candidate 0.5.20 targets audited Codex 26.901.41600 / 7982. The existing review
app remains `/private/tmp/codex-workflow-staging-e8WpMM`, with separate identity,
user data, Workflow runtime/settings/logs and disabled updater. See
`workflow-patch/docs/PARALLEL_DEVELOPMENT.md` for the isolation contract.

The app-initial asset `app-initial-86767c3d23e5.js` exposes native persisted-state
read/write functions `iqt` / `sqt`. Its sidebar uses `sidebar-width`, defaults to
275, and clamps to 240–520. Settings unmounts the app sidebar; writing this store
updates its next mount and preserves native drag resizing. The new IPC accepts
only the trusted main frame at `app://-/index.html` and executes fixed code.

Native sortable defaults in the same asset are 200ms/ease for displaced rows
(`XVa`) and 250ms/ease for drop (`yAe`). Owned rows retain their identity and
animate from their current displayed positions when interrupted. The original
React-owned navigation remains in place; scoped CSS controls order/visibility.
Native tab and menu arrow traversal follows the visible order.

Native glyph assets include Eye `eye-dGE6gU_D-ad10f1e5fc75.js`, EyeOff,
GripVertical, LockKeyhole and ChevronLeft. App and settings navigation icons are
cloned from their real rows. Input and segmented-control classes were captured
from Appearance and General. Width keeps the native field boundary and places
the px suffix inside it.

Settings has a span.contents-wrapped Account button without a panel slug. The
wrapper and its actual button keep a trailing order when settings are sorted; otherwise Account's
native order:0 incorrectly moves it to the top. Sorting remains within each
native settings group. Workflow, Settings and Log out remain accessible.

Preferences use schema 3 in both normalisers and the existing atomic writer.
Failed writes restore canonical controls, navigation and order. Width uses the
native store, with explicit rollback of the edited field on IPC failure.

## Verification checkpoint

- Full `npm run check`: 155 passed. After the final display:contents and native
  Reduce motion corrections, all 57 preload tests passed again.
- Subsequent focused tests include pointer preview/cancel/drop, reduced motion,
  failed-save rollback, native Account wrapper order, visual keyboard order,
  bounded width IPC and field rollback.
- Staging refresh verifies identity, restores runtime files on failure, signs
  the app and validates ASAR integrity before launch. Runtime backups and logs
  are in `output/sidebar-navigation/`.
- Live: Workflow home and child page visually inspected; inline px visible;
  dragging and keyboard reordering work; Settings shortcut opens native Settings.
- Live: entering 321 produces an actual 321px sidebar. Manual drag then reads
  354.0989 in the native store and 354 in the integer field. Hidden Pull requests
  occupies zero space; Recents has display:none and zero height.
- Live settings reorder exposed and motivated the Account-wrapper regression fix.
- Final signed runtime main/preload hashes match source, and runtime version is
  0.5.20. Final light General capture confirms Account remains after Analytics.
- Live account menu: Show pet precedes Usage; Invite a friend is absent; native
  Settings still opens Settings. Down-arrow focus follows Show pet then Usage.
- Native Reduce motion uses html[data-reduced-motion]; the owned animations read
  this before falling back to the system media query. Tests cover both policies.
- Narrow light DOM check at 736×860: page width 342, rows 340, no horizontal
  overflow; the complete numeric field is inside the viewport.
- Production dry-run correctly refuses unaudited 26.903.71938. The staging build
  remains the approved exact target; no allow-version override is used.

Final visual follow-up: with staging foregrounded, fresh light captures at full
size and 736×860 show the complete child page with correctly aligned native
icons, eye controls, fixed New chat and inline px. Labels wrap without clipping,
and normal settings-pane scrolling reaches the footer. Native Account stays at
the end of Personal after reorder.

Read-only live motion sampling captured 23 moving frames. Displaced rows settle
from 48px through 33.81, 20.33, 11.34, 7.98, 3.60, 1.17 and 0.12px to zero over
the native 250ms/ease drop transition. The final row order matches persistence.
See `output/sidebar-navigation/live-motion.json`.

Temporary ordering/visibility changes were reset and native width restored to
275. The previous window size and System theme are restored. Source review and
diff whitespace checks passed; the final runtime contains the teardown-safe
observer guard and its 57-test preload run has no callback errors. The final
signed main/preload hashes match source. Sidebar & navigation is left open,
with a fresh final dark screenshot confirming the layout and 275 px field.

All requested staging acceptance is complete. No general shortcut-creation
feature or production installation was added.

## Account menu sizing correction, 0.5.22

The user clarified that the menu must resize with the visible sidebar. The
0.5.21 fixed-width interpretation below is superseded. The native CSS sidebar
token is also insufficient: a 640px viewport measured a 400px sidebar but a
320px token. The account menu now measures its trigger's actual sidebar and
uses the native row padding. A ResizeObserver tracks only that sidebar and
open menu, disconnecting on removal, replacement or disable. Native inline
width remains untouched; the owned custom property is restored on release.
Regression proof includes a measured resize, portal replacement, unrelated
menus, and disabling customisations.

Final live 0.5.22 checks: 240px sidebar / 224px menu; 520px / 504px;
restored original 446.48px / 430.48px. A collapsed responsive sidebar retains
the native minimum 224px menu instead of shrinking to zero. All 69 renderer
and main tests pass, plus the version guard. Signed staging preload matches
source; `output/account-menu/resizing-fixed.png` was visually inspected.

### Superseded 0.5.21 investigation

The native profile menu uses the preferred sidebar width directly, even when
the visible sidebar is constrained by the window. Staging measured a 338.09px
menu next to a 240px sidebar with a 354.09px preferred width. Workflow now keeps
this menu at the native default: 275px minus native horizontal row padding
(259px at the current scale). Native viewport limits, text and interaction
remain in charge. The rule is scoped to a menu whose labelled trigger is the
sidebar's Open profile menu button, and disappears when customisations are
disabled. React's inline width remains untouched for exact restoration.

The regression covers width updates, portal replacement, an unrelated menu,
and disabling customisations. Chromium geometry is the sizing authority;
JSDOM drops !important when parsing this nested calc/var declaration.

Staging verification: native drag to 520px and back to 240px leaves the menu
259px wide at both sizes, with all six rows and no horizontal overflow. Fresh
post-relaunch screenshots are in `output/account-menu/`. The deployed preload
hash matches source; the guarded refresh passed signature and integrity checks.
The full check passed 155 tests with one stale version assertion; after updating
that assertion to 0.5.21 its focused rerun passed. No production app was changed.
