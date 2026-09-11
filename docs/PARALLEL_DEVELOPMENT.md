# Parallel development without interrupting Codex work

This is the deployment policy for developing Codex Workflow while the production Codex app is doing unrelated work.

## Decision

Use three separate lanes:

1. **Production Codex** stays open for real projects and continues using its current installed Workflow runtime.
2. **Source worktrees** hold independent fixes and features. They may run tests, status, and dry-runs, but never install themselves.
3. **One disposable staging app** is created only for live Electron and visual checks. It is isolated from production and removed after the integration run.

Do not maintain several everyday Codex app copies. One production app plus one disposable staging app gives the required isolation with less state, signing, updater, and cleanup risk.

## What is allowed while another Codex task is active

| Action | Allowed? | Boundary |
| --- | --- | --- |
| Edit source, add tests, review a diff | Yes | Dedicated Workflow worktree or feature branch |
| Run `npm run check` | Yes | Source and temporary fixtures only |
| Run `npm run status --silent` | Yes | Read-only production inspection |
| Run the status-derived install/reapply `--dry-run` | Yes | Preflight only; no app-bundle mutation |
| Build or launch the isolated staging app | Yes | Integration task only; staging roots only |
| Install, reapply, recover, uninstall, quit, relaunch, or kill production Codex | No | Wait for explicit approval and a quiet window |
| Merge, push, tag, publish a release, or update `main` | No by default | Requires the user's request or approval |

An active response, subagent, terminal command, browser/computer-use operation, Studio bridge, or unsaved project flow counts as important work. Do not assume that a task is safe to interrupt merely because its files are in another repository.

## Source lane

- Start each independent change in a Codex-managed worktree or a separate Git worktree/branch.
- Give parallel workers disjoint file ownership. Only the integration task resolves overlaps.
- Do not start several overlapping branches from a dirty integration checkout. First commit the intended baseline or explicitly choose which local changes each worktree receives.
- Keep the local checkout as the integration lane. A worker finishes at a reviewable diff or commit; it does not deploy.
- Run focused checks in the worktree. Use Handoff to Local only when the integration task is ready to review or merge the result.

Codex worktrees are source isolation, not runtime isolation. Every worktree still runs on the same Mac and could target the same installed app if an agent ignores this policy; the production mutation ban therefore still applies.

## Staging app contract

The project has previously validated live renderer behavior with this topology. Reuse the topology, but recreate it from the currently audited build each time.

The staging app must have all of the following:

- an APFS clone or disposable copy under a uniquely generated temporary directory;
- a distinct bundle identifier, bundle name, and display name;
- its own Electron user-data directory and single-instance state;
- the real macOS account `HOME` for Keychain lookup and OAuth browser launches; isolate shell startup with `ZDOTDIR` and app state with explicit paths, not a fabricated `HOME`;
- its own Workflow runtime root, settings, logs, transaction journal, update state, and staged files;
- a source-built candidate runtime, never the production runtime by symlink or shared path;
- updated ASAR integrity metadata and an ad-hoc signature after staging-only changes;
- a localhost-only, unique DevTools port when instrumentation is required;
- no production LaunchAgent, release updater, automatic relaunch, or production recovery path;
- an exact process/path check before launch, stop, or cleanup.

The staging app must not:

- modify `/Applications/ChatGPT.app` or the production Workflow application-support directory;
- use the production Electron user-data directory or `CODEX_HOME`;
- copy, symlink, or overwrite live transaction journals, backups, logs, settings, cookies, credentials, or sessions;
- become the place where unrelated project work is performed;
- survive as an undocumented second production installation.

If a verified staging helper is unavailable, stop at fixtures and source proof. Do not improvise low-level copy, plist, ASAR, signing, launch, or cleanup commands against production paths.

## Promotion gate

One integration task owns promotion. It may promote only when all applicable gates pass:

1. The candidate is integrated from reviewed worktree commits with no unresolved overlap.
2. `npm run check` passes.
3. Fresh `npm run status --silent` has no unsafe journal, integrity, version, backup, or loader condition.
4. The correct status-derived dry-run passes.
5. UI/runtime changes pass focused staging checks against the currently audited Codex build.
6. The source diff, staging result, and remaining limitations are reported separately from installed state.
7. The user explicitly approves production mutation in the current task.
8. No important production Codex task is running.

Then quit production Codex once, run the guarded installer/reapply once, relaunch once, inspect logs and UI, and rerun status. A failed gate returns the candidate to source work; it does not trigger a partial production deployment.

Do not use `launchctl submit` for a one-shot deployment. The September 4 `com.ellisjpeg.codex-workflow-production-repair-20260904` attempt stopped at its quiescence gate. Use the bounded setup command; a detached launchd deployment must explicitly use `RunAtLoad=true`, `KeepAlive=false`, and no interval, record its attempt before touching the app, and be removed after its terminal result. Never reopen the app from a failed quiescence/install path. An unchanged loaded updater agent must not be booted out from its own installer child.

## Ownership and cleanup

- Only the integration task may create or control the staging app.
- Other workers may provide source commits and test evidence but must not launch or stop either app.
- Record the staging root, bundle identifier, runtime root, user-data root, process ID, and DevTools port before use.
- Stop only the exact staging process, then remove only its validated temporary root.
- Keep production backups. Staging cleanup is never a reason to remove a production backup or application-support directory.

The result is deliberate: parallel model usage happens in source worktrees; risky app mutation remains serialized at the final promotion boundary.
