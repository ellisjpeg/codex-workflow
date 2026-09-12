# Composer preview, Workflow 0.5.38

Dedicated worktree: `workflow-composer-preview`, branch
`fix/composer-preview-20260912`. Baseline is the complete local 0.5.36
`workflow-codex-8881` snapshot, including its uncommitted compatibility work.
The exact sidebar icon fix and regression assertions from task
`01a09621-ff8e-79e2-8c7d-0f1f6a4020e8` are included unchanged. That task completed
its staging checks before this task took control. Its worktree is untouched.

Codex 26.908.40834 / 8881 changed the Composer CSS module classes and introduced
layered reasoning-label animation. The obsolete model selector prevented a
complete native composer capture; the old fallback then displayed hidden
measurement text and vertically stacked controls because its CSS was absent.

The fallback is a sanitized native staging capture from this exact build.
Current classes were checked against live CSS and packaged
`app-primary-44ec287874b7.js` / `app-primary-42ed0a4bb496.css`. Model and effort
selectors now match that build. Real composer updates preserve the native
accessible label and all nine animated effort text layers. An inert preview
keeps only the selected effort text and drops the frozen measured width.
Drafts, attachments, native IDs/references and editable state remain scrubbed.
No provider, permission, persistence schema or request behavior changed.

Verification: updated native fixtures failed before the fix and pass afterward,
covering labels, layers, cold fallback, partial unmount, ambiguity, remount,
reset and rejected-save rollback. Final `npm run check`: 203 passed, no skips.
An intermediate run hit the existing Web Astra timing assertion; its focused
rerun and the final full run passed. The guarded production reapply dry-run
passed with no warnings; installed production remains 0.5.36.

Staging: `/private/tmp/codex-workflow-staging-uDKpBB`, isolated runtime and
profile, localhost DevTools 49258, final PID 58524. The guarded runtime refresh
preserved bundle identity/integrity/signature and backed up prior 0.5.37 runtime
and settings under `output/runtime-backup-1789226385746`.

Live preview controls share the same 28px height and vertical position at
1280px and 650px. No horizontal overflow; measurement text stays hidden.
Short/compact labels and microphone visibility work in preview and native
composer. Light/dark screenshots were inspected, preferences and System theme
restored, native navigation/remount and six 18px sidebar icons rechecked.
Evidence: `output/visual-evidence.json`, `output/composer-dark-1280.png`,
`output/composer-dark-650.png`, `output/composer-light-650.png`, `output/final.png`.

Composer is left open for review. Production was neither changed nor restarted.
Promotion should use this combined 0.5.38 candidate so neither fix is lost.
