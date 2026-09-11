# Workflow staging audit — 11 September 2026

Target: Workflow 0.5.23, Codex 26.901.41600 / 7982, isolated staging only.
Contract: current native UI is authoritative, as required by the design bible.

## Fixed

The starter used the concept's coral `bg-chart-red` for checked switches.
Native General and Appearance both use `bg-chart-blue`; the old test explicitly
expected red and therefore could not catch this discrepancy. Updated the master,
changed-only filter, and recent-chat refresh path. Added a regression covering
all three, including off/on transitions, plus the existing failed-save test.
Decorative tracks now use native `aria-hidden="true"` semantics.

## Evidence

| Gate | Result |
| --- | --- |
| Full syntax and test check | 157 passed, zero failures or skips |
| Native switch comparison | Identical RGB 58,131,247; track 32x20 and thumb 16x16 |
| Home and all navigation tabs | No horizontal overflow or unnamed buttons |
| Home accessibility references | One Workflow panel/current destination; no duplicate owned IDs or broken ARIA references |
| Search | Empty result and Escape restoration passed live |
| Keyboard reordering | Plugins moved above Scheduled, focus retained, original order restored |
| Persistence | Recent-chat off written to disk, restored on, blue refresh confirmed; full settings JSON equals pre-audit snapshot |
| Navigation/remount | Native Appearance and Workflow transitions, all three tabs and return-home passed |
| Light/dark and narrow layout | Native theme controls used; 736x860 viewport checked; screenshots visually inspected |
| Failure/restore, drag, reduced motion | Existing automated suite passed; previous live drag evidence reused because motion code is unchanged |
| Account menu resizing | Prior 0.5.22 measured-width checks reused; audit changes do not touch sizing |
| Staging deployment | Guarded refresh passed identity, signature, integrity, source-runtime checks; installed preload hash matches source |

Screenshots and logs: `output/account-menu/audit-*`.
Original System theme, viewport metrics and Workflow preferences were restored.
Workflow home is left open with the corrected blue switch.

## Scope and limits

This is a quick audit of the implemented Workflow home and Sidebar & navigation.
Composer, Conversation, Appearance & spacing, and Usage & indicators remain
intentional inactive placeholders. This was not a screen-reader, localization,
exhaustive zoom, or performance benchmark. RTL and reduced-motion utility paths
were covered by source/tests rather than a new live matrix. No production
installation or production restart occurred.
