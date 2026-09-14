# Security policy

## Supported version

Security fixes are applied to the latest source release. The installer separately guards the Codex Desktop build it has been reviewed against.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include authentication material, private prompts, local logs, account details, or complete app bundles in a public issue.

Include the smallest reproducible example, affected Workflow version, Codex version/build, and expected impact. Reports concerning arbitrary Electron or Codex behavior should first demonstrate that Workflow introduced or materially expanded the issue.

## Security model

- Installer identity, version, ASAR integrity, safe entry path, backup, and transaction checks fail closed.
- Runtime customization fails open so Codex can continue through its original entry.
- Renderer IPC covers normalised settings reads/writes, bounded log messages, update status/application, the fixed native Settings keyboard shortcut, and the bounded native sidebar-width bridge. It does not accept arbitrary shell commands, file paths or JavaScript source from a renderer.
- These handlers check the sender's `app://` URL. Sidebar-width access additionally requires the native main frame and index URL, an open Settings view, and an integer width from 240 to 520. Its native-store import is specific to the audited build. These checks do not make a compromised trusted Codex renderer harmless.
- Settings, runtime files, logs, backups, and transaction records are local to the current macOS user.
- The project does not collect telemetry or transmit settings.

The updater requests release metadata from its configured GitHub Releases API and downloads the asset URL returned by that metadata, following redirects. It requires the advertised SHA-256 digest, rejects unsafe archive paths and non-file/non-directory entries, validates release versions, and keeps exact Codex compatibility checks. A matching digest detects a changed download; it is not an independent signature or proof that a release is trustworthy. The release account, configured source and local runtime directory remain trusted code sources.

Isolated staging replaces the updater with a fail-closed stub and disables update configuration. Never reuse production runtime, settings or account directories for a staging check. See [CONTRIBUTING.md](CONTRIBUTING.md) for verification boundaries.

Modifying an application bundle invalidates its original Apple code signature. Workflow ad-hoc re-signs after install so the app can launch, preserves the original signature in the source backup, and reports ASAR integrity separately.
