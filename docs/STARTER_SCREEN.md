# Starter screen — 10 September 2026

Historical starter checkpoint. Sidebar & navigation and schema 3 supersede the
initial scope below; see `SIDEBAR_NAVIGATION.md` and `STAGING_AUDIT_2026-09-11.md`.

Scope: the supplied homepage, without tagline, Active setup/Save as, visual
customiser or import/export. Section buttons have hover/focus but no click action.
No child pages or interface effects are active. The prior renderer is parked,
and its existing tests still run against that archived source.

The master uses the existing `focusedInterface` Boolean and schema-2 canonical
main/renderer normalisers. No new IPC or disk format was added. The existing
atomic, owner-only writer persists changes and returns canonical state. Reset
restores this starter's master default and clears local view filters. Older
preferences remain on disk, inactive, so this temporary change is reversible.

## Current native evidence

- Codex 26.901.41600 / 7982, stock ASAR SHA-256
  `077cc65356aeae34c5d8b4de0b4cc383f6fb137ed1d69a9b3dfe69ffafa058ab`.
- Settings-page and app-initial CSS hashes match `CODEX_26.901.41600_AUDIT.md`.
- General and Appearance inspected live. The existing settings shell, cloned
  inactive/active navigation, card separators and switch dimensions are reused.
- Search clones the current native Settings search wrapper, with identities
  scrubbed and owned handlers. Clear icon is the native `VN` component; row
  chevron path is from the installed ChevronRight asset.
- The initial coral choice was incorrect and is superseded by 0.5.23: native
  General and Appearance switches use `bg-chart-blue`. Workflow uses that same
  checked token, with native unchecked, directional thumb travel, motion and
  focus states. A token existing in Codex does not make it correct for every control.
- Only the Settings shell is observed after discovery; shallow mount observers
  handle replacement. Hidden native content retains its inline display priority
  and inert state. No steady-state full-document observer is installed.

## Verification

Source gates and live results are recorded in `output/starter-screen/` for this
local worktree. Tests cover the pared-back screen, native-feature preservation,
search/clear/empty state, view-only filtering, reset, canonical writes, concurrent
write rejection, visible rollback, focus, navigation restoration and observer
scope. Live staging uses an isolated bundle, user data, CODEX_HOME, runtime and
updater state. Production is not installed or restarted.

Final source check: `npm run check` passed 148 tests, with none skipped;
`install:patch -- --dry-run` and `git diff --check` passed. Live checks covered
search/clear/empty results, switches, reset, hover, keyboard focus, inert section
activation, native navigation and master persistence across a staging restart.
The initial extra visual check was inconclusive because capture returned a
stale General-settings frame. The follow-up completed on 10 September using
the same staging process and a runtime matching the worktree source:

- Native Window → Move & Resize → Left: dark and light starter layouts fit
  without clipped labels, overlapping controls or horizontal overflow. All
  five rows and Reset remained visible.
- Light theme: native card borders, separators, search, switch states and text
  remained legible. Composer hover and the Conversation keyboard focus ring
  were visibly distinct; clicking and pressing Return left the page unchanged.
- Native Return to Previous Size: the wider light layout retained correct
  alignment and spacing.
- System theme and the previous window size were restored; the dark Workflow
  page was visually confirmed and left open. No passcode prompt appeared.

No product code changed during this verification; the existing 148-test result
was reused. Native UI screenshots and accessibility results are in the task.

The sole review app is recorded in `output/starter-screen/staging-root.txt`.
Its current root is `/private/tmp/codex-workflow-staging-e8WpMM`; it is left open
on the starter with customisations on, an empty search and changed-only off.

Staging host observation: after reopening its signed-in profile, the native
window could be blank before opening Settings. The same condition reproduced
with Workflow suppressed by the staging-only `DISABLED` marker. Native Window
→ Fill restored its content. The marker was removed after this comparison; no
host-startup workaround was added to Workflow.
