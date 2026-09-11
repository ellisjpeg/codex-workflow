# Sidebar & navigation, 11 September 2026

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
