# Codex 26.901.41600 / 7982 compatibility audit

Audited on 5 September 2026. Source candidate: Workflow 0.5.19, based on committed
0.5.18 (`d27d034a42e0636edb307a6ff54b6a0569d747a1`). No uncommitted work from another
feature branch was included. This is bundle and fixture evidence; exact-build live
staging and production promotion remain separate gates.

## Before state and cause

The audited Codex bundle reports `26.901.41600` / `7982` in both
Info.plist and app.asar/package.json. Its identity remains `com.openai.codex` /
`openai-codex-electron`, with Electron `42.3.0` and main entry
`.vite/build/early-bootstrap.js`.

The previous compatibility manifest accepts only `26.901.31953` / `7868`, so it
rejects the newer build before installation. The source change updates that exact
pair after the bundle comparison below. Runtime code remains byte-for-byte equal
to the committed 0.5.18 baseline. Machine-specific installation and signature
observations are retained only in the local verification report.

## Bundle evidence

SHA-256 values identify the inspected source, not a new global hash allowlist.

| Artifact | SHA-256 |
| --- | --- |
| Current complete app.asar | `077cc65356aeae34c5d8b4de0b4cc383f6fb137ed1d69a9b3dfe69ffafa058ab` |
| Current ASAR header / plist integrity | `3f7cb0a2856ec33e9240b111f3d475123d237a7f8198b39c8160f7ea3ffaa733` |
| Previous verified stock app.asar, 26.901.31953 / 7868 | `4b385ffce845bb319a1769a3cb59751e1a8f157bab79f5018ba51d83f9e6df4e` |
| `.vite/build/early-bootstrap.js` | `44b33a579ed19385091479e53128e88dd677a9763703bac38579234ef6e58d2e` |
| `.vite/build/bootstrap-Btwipr-d.js` | `19245051fc21550fe2cdd0331eec5408b8eabe09d3196c23f1777cad35d44374` |
| `.vite/build/main-C5K7o1Hr.js` | `1a12a4625ca931b86befd0c40e3ab1b17355bbb8ef87092b1d239e0439ce0d26` |
| `.vite/build/sandbox-preload.js` | `44509a20aa02117153c3b6e0d340f0e2acd554f38bc1c7752909c6a702a52f13` |
| `.vite/build/preload.js` | `6418d42c99961587e70f644f9757e7a2c124b4bf09a39ed75ca11a7dedffdc49` |
| `webview/assets/settings-page-27e621909353.js` | `ec3b82a1996c02518749108bd8bdf1737177c2abef6828ed16122e86d59af9f8` |
| `webview/assets/app-initial-86767c3d23e5.js` | `fb72076ee44f6596f8dafa9a3effe37a3527a87db21fde8b4042233957b554bb` |
| `webview/assets/app-primary-139889e10fbd.js` | `5f2eb43484da39a9459a918c52cb6d0ff8df6ea8184d23bfc448f0702a86d010` |
| `webview/assets/app-initial-5b0a474bff5e.css` | `3c3865c9f704dee3c444905a7625e757cd25c967a765d3f7710d8c14f46bd783` |

All 20 `.vite/build` JavaScript files and all 204 renderer CSS files match the
previous stock archive by path and bytes. The early entry still loads `src`, the
desktop open-path queue, then the bootstrap asynchronously. Workflow's fail-open
loader, session registration and original-entry continuation require no change.
The installed framework still contains `registerPreloadScript`, `getPreloadScripts`
and `unregisterPreloadScript`; this is static API evidence, not a live invocation.

## Renderer and storage contracts

The rebuilt renderer was formatted and its relevant functions compared with the
previous build. Twelve containing functions have equal AST structure after removing
source locations and normalizing variable/function identifiers, while retaining
property names, literal values and operators. This assists the source audit; it
does not establish live geometry or equivalence of every imported dependency.

| Surface | Current evidence and retained contract |
| --- | --- |
| Settings navigation | `settings-page` function `yn`: `nav.sidebar-navigation`, Settings accessible name, grouped native sections and `.overflow-y-auto`; only enabled internal rows receive `data-settings-panel-slug`. Search uses a separate result renderer. |
| Settings routes | `settings-page` function `Wn`: `/settings/:section/*`, native selection callbacks, grouped sidebar and native content layout. Workflow continues cloning a destination and restoring native content/history. |
| Sidebar and titlebar | `app-initial` functions `_Ya` / `qJa`: `.app-shell-left-panel` and fixed `header.h-toolbar.draggable`, sidebar-aligned region and existing nested controls. No geometry/cardinality fallback was broadened. |
| Switch | `app-initial` function `XK`: native button/switch, checked state, focus and disabled props, track/thumb tokens; all CSS, including directional travel and motion tokens, is unchanged. |
| Composer | `app-primary` function `f$t` and `app-initial` function `BLs`: presentation owner with `data-composer-layout`, footer rows, idle `Dictate` versus active dictation controls. |
| Account and Help | `app-primary` functions `cir`, `Vmn`, `Bmn`, `Jmn`: `Open help menu`, Show/Hide pet, native Settings and Invite a friend identities and handlers remain. Existing menu-owner/ambiguity guards and restoration remain intact. |
| Pull requests | `app-primary` function `ZSn`: native sidebar destination still uses `/pull-requests`; the existing scoped row effect is retained. |
| Settings shortcut | `app-initial` command definition still binds Settings to `CmdOrCtrl+,`; the trusted main-process bridge remains unchanged. |

The app protocol registration and sandbox/preload implementation are among the
unchanged main-process chunks. `webview/index.html` has an identical CSP meta value,
including `style-src 'self' 'unsafe-inline'`, so the existing scoped visibility CSS
requires no policy change. No CSP, sandbox, IPC sender guard or signing entitlement
was weakened.

Workflow keeps schema 2, matching main/renderer normalizers, validated hidden-page
slugs, atomic owner-only settings writes, canonical IPC responses and optimistic
rollback. Defaults and persisted values are unchanged. The updater consumes the
existing exact version/build manifest contract; a branch push does not publish a
release or trigger automatic repair. No observer, timer, selector or runtime code
changed, so this candidate adds no renderer work or polling.

## Installer, repair and restoration

The normal installer still checks package/plist identity and version/build pairing,
SHA-256 header integrity, safe original entry and pending transactions before
replacement. Backups, atomic replacement, journal phases, recovery, signature
handling and uninstall are unchanged. Staging still uses separate identity, state,
runtime, CODEX_HOME and updater controls with exact process ownership.

The current archive contains 402 unpacked files versus 401 in the previous backup.
The only added unpacked path is the node-pty node-addon-api
`node_addon_api_except.stamp` build artifact. Existing unpack discovery handles it
without special casing. A temporary rebuilt archive preserved all 402 unpack flags
and the exact content of all 8,929 original regular files except package.json,
whose main/Workflow metadata is intentionally changed. The embedded loader matches
source; original main and source fingerprint are retained. Its paired plist passes
preflight. Restoring the stock ASAR/plist into temporary targets reproduces their
exact hashes. No app was launched or signed for this archive-only check.

## Verification and remaining gate

- Regression first: the new current-build acceptance fixture and guard assertions
  failed against the old metadata (`Unsupported Codex version 26.901.41600`). They
  pass after the manifest update. Previous-version and adjacent-build rejection,
  plus package/plist mismatch guards, pass.
- `npm run check`: all managed JavaScript syntax checks and all 144 tests pass,
  including settings rollback/remount/observer scope, repair, interrupted recovery,
  staging isolation and restoration fixtures. No separate type-check script exists.
- `npm run install:patch -- --dry-run`: passes without `--allow-version` for build
  7982 with matching ASAR integrity. Existing signature handling is unchanged.
- Status confirms both version/build support flags are true. Installation-specific
  observations remain in the local report; no production installation was run.
- `git diff --check`: passes. Review found no runtime changes, guard weakening,
  new dependencies or generated assets in the commit.
- Live staging was unavailable under the exclusive ownership gate. No existing
  staging instance was inspected interactively, reused, stopped or modified.

Remaining validation: once staging is available, use the guarded helper for
one isolated build-7982 launch and check native settings/page navigation, feature
effects, reopen/remount, keyboard and visual states. Static contracts and fixtures
do not prove those live states. Production installation/restart, release, merge and
tag are outside this source-only change.
