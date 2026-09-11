# Codex 26.903.71938 / 8576 compatibility audit

Workflow 0.5.24 combines the Workflow home, sidebar/navigation ordering and visibility, drag correction, microphone visibility, native usage indicator, Web Astra label presentation and guarded staging fixes.

## Native contracts

- Package identity remains `openai-codex-electron` / `com.openai.codex`; the original entry is `.vite/build/early-bootstrap.js`.
- The installed Workflow loader uses the external main/preload runtime; the existing signature, ASAR integrity, stock backup and transaction checks remain enforced. No version override is used.
- `app-initial-a9514281e192.js` exports the mounted route scope getter `ios` as `$f`, the native `rate-limit-status` query `lF` as `sAt`, and message dispatcher `H` as `xmn`. The query uses native `/wham/usage` handling, query cache and configurable staleness. Workflow adds no polling interval or separate allowance API.
- Native sidebar readers/writers `Z0n`/`Q0n` use `Jx`/`Yx`, exported as `Y2t`/`$2t`, for `sidebar-width`. The native 240–520px bounds and 275px fallback remain unchanged.
- `app-primary-defe25a79fce.js` retains composer layout/rows, navigation target, intelligence trigger, selected reasoning effort and the high-effort message identity. Label presentation is exact-model scoped; it does not select a model, alter effort or suppress native warnings.
- `settings-page-10f72f72ae31.js` retains the Settings navigation and panel-slug contract. The initial app asset retains sidebar/header structure and native blue switch primitives.

## Release boundary

Only Workflow source, tests and documentation belong to this repository. The updater archive uses an explicit runtime/installer file list. OpenCodex, personal account bindings, usage databases, Web bridge servers and the rejected Budgeted Tool Results experiment are excluded.

## Verification

- `npm run check`: 185 passing checks, no failures or skips. Coverage includes guarded installer/recovery, navigation drag, settings migration and rollback, native usage-cache lifecycle, placement keyboard interaction and the update handoff.
- `npm audit --audit-level=moderate`: no reported vulnerabilities.
- Exact-build production dry-run: passed without warnings or a version override.
- Fresh isolated build-8576 staging: identity, signature, ASAR integrity, runtime hashes and isolation checks passed. Sign-in survived its own guarded restart; Workflow home and Usage controls rendered, and the native weekly allowance appeared in the toolbar. The placement menu was inspected live.
- Existing build-7982 navigation drag, theme and narrow-width evidence is retained in the linked feature audits. This release did not repeat that entire visual matrix on build 8576; fixtures cover those unchanged interactions.
- Official runtime-only installation: succeeded without warnings. Status reports 0.5.24, matching runtime/source/loader hashes, a present source backup, valid signature/integrity and no pending transaction. The unchanged embedded loader remains 0.5.19. App restart is required to load the new runtime; installed-file status alone does not prove the running UI.
