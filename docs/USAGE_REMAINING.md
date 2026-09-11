# Usage remaining

Local candidate for Codex 26.901.41600 / build 7982. Production installation is separate.

## Behaviour

- Enabled by default; toolbar by default. The independent Workflow switch and
  adjacent in-app location dropdown persist `showUsageRemaining` and
  `usageRemainingLocation` (`toolbar` or `composer`) as additive schema-2 settings.
- Shows the shortest reported core plan window, preferring 5hr over weekly.
  An exhausted longer core window overrides to zero. Weekly/monthly-only windows
  work without assumptions about subscription names. Missing or expired data is
  `—`, never an invented full allowance. Monthly durations cover 28–31 days.
- Toolbar: immediately before Share, with native muted text, height and hover.
  Composer: immediately after permissions, native gap and text-default foreground.
  Tooltips name the window; clicking opens native `/settings/usage`.
- The location menu uses the current Language picker’s in-app panel, row, focus,
  padding and checkmark tokens. Supports mouse, arrows, Home/End, type selection,
  Enter/Space, Escape, Tab and outside dismissal. Saving temporarily disables
  controls; failures restore the prior placement and focused trigger.

## Data and performance

Reuses the existing native `rate-limit-status` QueryClient cache and notification
dispatcher through a fixed, build-audited main-world adapter. Only validated
percentage/window/reset metadata crosses into the isolated preload. No new API,
credentials, account payload logging, response interception or polling interval.
Native reads retain their 60-second staleTime. One owned timeout targets reset;
account changes/reconnects/reset force an authoritative native refresh. Disable,
unload, account change and replacement scope dispose/reject stale work.

Details and installed-source references: [bridge evidence](USAGE_BRIDGE_EVIDENCE.md).

## Verification

- Main persistence/atomic failure tests, renderer selection/rollback/keyboard and
  cleanup tests, and native cache/notification/account/reset tests are runnable
  with `npm test`. Full check passed 167 tests before the in-app menu correction;
  the final renderer suite passed 56 tests, followed by eight menu-focused tests.
  The installer/staging subset passed 43 tests after default updates.
- Isolated Staging displayed the account’s actual weekly value. Native cache
  fixtures verified 5hr priority, weekly, a 28-day monthly window, and exhausted
  weekly override. Original cache data was restored in `finally`; no server
  allowance was changed. Monthly and 5hr accounts were not separately signed in.
- Native toolbar comparison: both Share and counter use 28px height, 14px font,
  and `rgba(255,255,255,0.498)` text in dark mode. Composer: 28px height, 13px font,
  white foreground, 6px horizontal padding and the existing 5px control gap.
- Both placements fit the live 800px viewport without horizontal overflow.
  Menu selection and direct Usage navigation were exercised through the UI.
- Light and dark appearances were visually checked with the native Appearance
  setting. Light composer text uses the native `rgb(26,28,31)` foreground; the
  original System appearance was restored after the check.
- In a controlled 100-update cache test: disabled p95 0.2ms; enabled p95 0.4ms;
  all enabled updates changed the counter synchronously. One hundred unchanged
  updates caused zero counter DOM writes. This measures local display work,
  not server reporting latency or a whole-app CPU benchmark.
- Guarded installer dry-run passed with no warnings. Production remains stock,
  with unchanged ASAR fingerprint, valid integrity/signature and no pending
  transaction. No production install, relaunch, commit or push was performed.

Screenshots and reproducible staging probe are in the workspace `output` folder;
the development ledger records the isolated app identity and current checkpoint.
