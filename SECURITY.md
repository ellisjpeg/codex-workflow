# Security policy

## Supported version

Security fixes are applied to the latest source release. The installer separately guards the Codex Desktop build it has been reviewed against.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not include authentication material, private prompts, local logs, account details, or complete app bundles in a public issue.

Include the smallest reproducible example, affected Workflow version, Codex version/build, and expected impact. Reports concerning arbitrary Electron or Codex behavior should first demonstrate that Workflow introduced or materially expanded the issue.

## Security model

- Installer identity, version, ASAR integrity, safe entry path, backup, and transaction checks fail closed.
- Runtime customization fails open so Codex can continue through its original entry.
- Renderer IPC is limited to Workflow settings and bounded log messages.
- Settings, runtime files, logs, backups, and transaction records are local to the current macOS user.
- The project does not collect telemetry or transmit settings.

Modifying an application bundle can affect macOS code-signature status. ASAR integrity and code signing are checked and reported as separate properties.
