# Usage & indicators

Local Workflow 0.5.41 candidate for Codex 26.908.40834 / build 8881. Production
installation remains a separate, explicitly authorised step.

## Behaviour

- Workflow’s home page contains four active sections. `Appearance & spacing` is
  removed, so `Usage & indicators` follows `Conversation` without an empty row.
- The Usage page intentionally has no Preview. Its Usage card controls visibility,
  toolbar/composer placement, remaining-only or reset detail, and the chosen limit.
- Limit choices are derived from the account windows Codex actually returns:
  5hr, weekly, monthly, and `5hr + Weekly` only appear when available. Automatic
  uses an exhausted window when present, otherwise the shortest available window.
  Missing or expired data stays `—`; no subscription name or allowance is guessed.
- Combined display is `5hr 93% · Weekly 54%`. Context usage can be appended in the
  same indicator from the current thread’s native token-usage store.
- Low-usage alert compares remaining percentage with a 1–50% threshold. Only the
  account-usage text receives native `text-warning`; Codex’s semantic warning token
  supplies theme-specific contrast instead of a hard-coded colour.

## Persistence and data

Schema 5 adds `usageDisplay`, `usageWindow`, `showContextUsage`, `lowUsageAlert`,
and `usageAlertThreshold`; main and renderer normalisation match, writes remain
atomic, and failed optimistic saves roll back. Existing usage visibility and
placement defaults are preserved.

The fixed build-audited adapter reuses Codex’s `rate-limit-status` QueryClient,
notifications, route scope, and token-usage store. Only validated percentages,
durations, and reset times cross into the isolated preload. It adds no API call,
polling interval, response interception, credential access, or plan lookup.

Historical bridge evidence: [usage bridge evidence](USAGE_BRIDGE_EVIDENCE.md).

## Verification

Run `npm run check`, then the status-derived guarded installer dry-run. Live visual
checks must use one disposable staging app with isolated identity, data, Workflow
runtime, settings, logs, and updates. Synthetic 5hr/weekly/context values may be
dispatched only inside staging and must be removed before cleanup. Verify normal
and warning states in dark and light themes; never relaunch or mutate production.
