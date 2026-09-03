# Codex Workflow agent instructions

Read `docs/PARALLEL_DEVELOPMENT.md` before changing or testing this repository. If a parent workspace supplies a Codex Workflow design bible, read that too; its current-build evidence and safety contracts are normative.

- Work on source in a dedicated worktree or feature branch. Preserve unrelated dirty files and do not merge, push, tag, or release unless asked.
- Source changes authorise source checks only. They do not authorise install, reapply, recovery, uninstall, app quit, relaunch, process termination, or mutation of the production Codex bundle or runtime.
- `npm run check`, `npm run status --silent`, and the status-derived `--dry-run` are the normal source gates.
- Live UI or Electron checks must use a verified isolated staging clone. Never share the production bundle identity, user-data directory, Workflow runtime, settings, logs, transaction journal, updater state, or `CODEX_HOME`.
- Never interrupt the production app while another Codex task matters. Production promotion requires explicit current-turn approval and a confirmed quiet window.
- Only one integration task may own staging or production promotion at a time. All other tasks stop at a reviewable source branch or worktree.
