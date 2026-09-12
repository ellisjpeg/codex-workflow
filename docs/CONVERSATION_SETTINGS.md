# Conversation settings, 0.5.35

## Approved production installation, 12 September 2026

Jayden approved promotion of the complete staging candidate and publication to
GitHub. The guarded runtime-only installer installed 0.5.35 without warnings.
Fresh production status reports `ok=true`, `recommendedAction=none`, matching
source/runtime/loader files, valid signature and ASAR integrity, and no pending
transaction. Existing production settings and app-bundle integrity are unchanged.
Evidence: `output/production-install-0535.json` and
`output/production-status-0535.json`.

The running app was left open to preserve active tasks. A restart is required
to load the new runtime; production UI verification after restart is pending.
The implementation and verification history below describes the staging phase.

## Follow-up corrections

Plain text now preserves the native user-side alignment and maximum width;
only bubble decoration is removed. Preview timestamps follow the full content,
including expanded tool activity. Actual messages keep their native sent times.
The user footer collapses the hidden action group's intrinsic width and gap,
then interpolates both on hover or keyboard focus using the native 150ms token.
Buttons stay anchored to the footer edge. Chromium in the audited build supports
`interpolate-size: allow-keywords`; no measurements, observers or fabricated
timestamps are needed. Native and system reduced-motion preferences disable it.

The full 203 checks passed, followed by 73 renderer checks after the final
button-edge refinement. Staging geometry checks cover right-aligned plain text,
timestamps below expanded preview tools, intermediate hover frames, focus,
reduced motion, and intrinsic widths of 26px (copy only) and 54px (copy/edit).
Copy-only coverage uses a disposable clone of the native pending structure;
no new AI request was started. Existing settings are restored after checks.
Evidence: `output/conversation-fixes-evidence.json` and
`output/conversation-fixes-check.log`.

Dedicated worktree: `feature/conversation-settings-20260912`. This snapshots the
tracked, uncommitted 0.5.33 baseline from `workflow-composer-settings`, including
its inherited Usage, navigation and Composer work. `output/task-baseline` records
the files before this task; Git HEAD alone is not this task's diff.

## Behaviour and persistence

Workflow > Conversation provides a message preview with the supplied example
copy, Conversation width, Message spacing (Compact / Default / Relaxed), User
messages (Bubble / Plain text), Tool activity (Summary / Expanded), Show
timestamps and Reset this section. The setup footer and code-block collapsing
control are omitted. Preview tool details can also be opened manually.

Five optional schema-4 keys are normalised identically in main and preload:
`conversationWidth` (null, native width; numeric values clamped to 480–1440 in
8px steps), `messageSpacing` (`default`), `userMessageStyle` (`bubble`),
`toolActivity` (`summary`) and `showMessageTimestamps` (false). The existing trusted
IPC and atomic settings writer handle saving, canonical reconciliation and
failure rollback. Reset only writes these five keys. Disabling Workflow restores
native presentation. Composer and Usage preferences remain separate.

## Native evidence and ownership

Audited installed Codex 26.903.71938 / 8576 and the isolated staging renderer:

- Native Appearance provides the range thumb/track utilities, theme tokens and
  `data-reduced-motion`. Native General and the existing Workflow pages provide
  switch, segmented-control, menu, focus, separator and row primitives.
- The only allowed message-column owner is
  `.thread-scroll-container[data-app-action-timeline-scroll]` containing one
  `[data-thread-user-message-navigation-content="true"]`. Ambiguous columns
  are not changed. The composer column, scrolling structure and virtualizer
  remain native. Explicit width respects `--thread-wide-block-inline-shift`;
  null removes the override and follows the current native/Composer width.
- Native `Jca` in `app-initial-a9514281e192.js` uses
  `--conversation-item-gap` for message spacers. Compact and Relaxed use two and
  six spacing units; default removes the override. Grouped tool spacing is intact.
- `subagent-activity-chip-group-24069c4f6521.js` supplies native user bubbles,
  sent-time labels and `RD`/`MD` activity presentation. Plain text restyles only
  bubbles under native user anchors. Text, attachments, editing and copy remain
  React-owned. Native timestamp labels are revealed without fabricating dates
  or revealing idle user action buttons. The preview timestamps are examples.
- Completed-turn activity is the one `button[aria-expanded].max-w-full.text-size-chat`
  with an `svg.icon-2xs`, within its content-search turn but outside message units,
  menus, dialogs and popup triggers. Its native click handler owns the content,
  animation, accessibility state and scroll anchoring. Each choice is applied
  once per mounted disclosure; manual clicks are respected until the preference
  changes. Active tool cards, approvals and cancellation controls are untouched.
- A narrow child-list observer handles new turn/disclosure mounts, ignores text
  streaming and coalesces discovery. Mount-chain watchers release stale owners.
  CSS is scoped by an owned marker and removed on reset; native inline styles
  are never overwritten. Disclosure restoration is conditional on ownership
  and manual interaction.

## Verification and deployment

The full source check passed 203 tests; all 73 renderer checks passed again after
the final responsive and theme corrections. Focused checks cover normalization,
atomic persistence, real-target presentation policy, preview copy and ARIA,
section reset, manual disclosure, ambiguity and rejected-save rollback. The
guarded exact-build reapply dry-run passed without warnings or version overrides.

Staging only: `/private/tmp/codex-workflow-staging-uDKpBB`. The existing guarded
refresh helper verifies the staging identity, ASAR fingerprint and signature,
backs up the runtime/settings, atomically installs the candidate runtime and
restarts only staging. Production is not modified or restarted by this task.
Live verification evidence is recorded under `output/`.

Live checks passed on real messages and a bounded read-only tool turn:
880px message width with native side-panel clearance; 8/24px message gaps;
native activity expansion and manual collapse; timestamps visible without idle
copy/edit controls; plain-text Markdown colour matching the conversation text
in a light pink theme. The scoped `--color-text-user-message` override is required
because native Markdown explicitly uses that token instead of inheriting its
parent colour. Reset removes it together with the other presentation overrides.

Light/dark screenshots at 1280/650px, keyboard menu navigation and Escape/focus
restoration passed. Large UI text (16px) at 650px wraps controls below readable
copy. Pink accent inheritance, reduced-motion preview disclosure and RTL switch
travel (-14px) with a keyboard focus ring were checked. Full translated-locale
navigation was not tested. Native responsive behavior hides the app sidebar
at the narrow viewport; return to the wide viewport for sidebar route checks.
Theme System, UI font size 14, motion System and the original Black light accent
were restored after testing.

All five non-default preferences survived a guarded staging restart and rendered
correctly. Section reset then passed; the page is left open with an 880px example
width and the other Conversation defaults. Source/staging main and preload
hashes match, unrelated Workflow settings match the initial staging snapshot,
and production remains healthy on 0.5.33 with its original integrity metadata.
Evidence: `output/live-evidence.json`, `output/accessibility-evidence.json`,
`output/persistence-evidence.json`, `output/final-integrity.json`,
`output/conversation-final.png` and `output/task-changes.patch`.
