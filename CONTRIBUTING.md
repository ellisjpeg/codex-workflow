# Contributing

Contributions are welcome when they preserve the guarded installer and native Codex behavior.

## Development setup

```sh
npm ci
npm run check
```

Node.js 24 or newer and macOS are required. Tests use temporary fixtures and must not modify `/Applications/ChatGPT.app`.

## Pull requests

- Keep changes focused and reversible.
- Add regression coverage for bug fixes and durable behavior.
- Preserve current settings, backups, rollback journals, and source fingerprints.
- Do not add document-wide polling or observers for steady-state UI work.
- Do not include app bundles, extracted proprietary assets, credentials, logs, user data, or machine-specific paths.
- Run `npm run check` and the status-derived dry run before requesting review.

Codex Desktop updates require a fresh audit of bundle identity, app version/build, ASAR integrity, preload support, native DOM contracts, selectors, install, recovery, and uninstall behavior.
