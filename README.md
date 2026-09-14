<picture>
  <source media="(max-width: 640px)" srcset=".github/assets/workflow-presentation/workflow-hero-mobile.png">
  <img src=".github/assets/workflow-presentation/workflow-hero.png" alt="Workflow — Make Codex yours" width="1200">
</picture>

**A more personal Codex experience, for people who build with prompts, code, or both.**

Workflow brings your preferences into Codex Desktop through native-feeling settings. Make room for what matters, quiet the distractions, and shape the app around the way you work.

[Get started](#install) · [Explore the settings](#your-setup-your-way) · [Release notes](docs/releases/0.5.43.md) · [Feedback](#help-shape-workflow)

## Your setup, your way

| Make it yours | What you can change |
| --- | --- |
| **Sidebar & navigation** | Choose what stays visible and keep useful shortcuts close. |
| **Composer** | Adjust width, model and reasoning labels, and microphone visibility. |
| **Conversation** | Set message spacing, width, bubble style, activity detail and timestamps. |
| **Usage & indicators** | Choose where usage appears, which limit to show and when to flag a low allowance. |

Workflow customises presentation. Your model, reasoning effort and permissions stay under your control.

## Install

**Alpha update · `0.5.43`.** Install Workflow directly into Codex. Read the [release notes](docs/releases/0.5.43.md) for scope and limitations.

### Compatibility

| You’ll need | Supported setup |
| --- | --- |
| macOS | Native checks completed on Apple Silicon; Intel is not yet verified. |
| Codex Desktop | **`26.908.40834`, build `8881`** |
| Node.js | **24.15+ in the 24.x line, or 26+** |

Other Codex builds are refused by the installer. Don’t bypass that guard.

Use a fresh checkout of the published release from Terminal:

```sh
git clone --branch v0.5.43 --single-branch https://github.com/ellisjpeg/codex-workflow.git codex-workflow-alpha-1
cd codex-workflow-alpha-1
npm ci --engine-strict
npm run setup -- --no-auto-repair
```

Setup checks compatibility and asks before installing into your existing Codex app. Save your work before agreeing to quit Codex. It does not create a separate app. Keep this checkout for recovery and removal.

**Installation changes the local Codex app bundle and replaces its vendor signature with an ad-hoc signature.** Read the [safety notes](#safety-notes) below first.

[Full setup guide](docs/INSTALLATION.md#install) · [Updates & automatic repair](docs/INSTALLATION.md#updates)

<img src=".github/assets/workflow-presentation/workflow-local-control.png" alt="A translucent folder, shield and return arrow connected by a flowing blue ribbon" width="1200">

## Local by design

Your Workflow settings, logs and backups stay on your Mac. Installation checks the supported build, keeps a backup and records changes for recovery. The updater verifies release downloads before applying them.

### Safety notes

- Quit Codex before installation, reapply, recovery or removal.
- The command above disables automatic repair when it installs. An already-current setup leaves existing preferences unchanged.
- Removal restores the backed-up app contents with an ad-hoc signature. Reinstall the official Codex app to restore the vendor-signed bundle.

### Recovery and removal

From your retained checkout, run `npm run status --silent`. Then quit Codex and use `npm run uninstall:patch` to remove Workflow. If status identifies a recoverable interrupted transaction, use `npm run recover:patch` first.

Stop on an unsafe journal, missing backup or unsupported state. Keep the backup and follow the [recovery guide](docs/INSTALLATION.md#recovery-and-removal).

<details>
<summary>How it works</summary>

A small loader starts Workflow’s local runtime, then continues into Codex even if Workflow cannot load. Updates use verified GitHub release assets and exact-build compatibility checks. [Technical details](docs/INSTALLATION.md#how-it-works) · [Security policy](SECURITY.md)

</details>

## Help shape Workflow

**We are not accepting pull requests, including code or documentation changes.**

A pull request (PR) is a proposal asking a project’s maintainer to review your changes and add them to the project.

[Bug reports](https://github.com/ellisjpeg/codex-workflow/issues/new?template=bug_report.yml) and [feature ideas](https://github.com/ellisjpeg/codex-workflow/issues/new?template=feature_request.yml) are welcome. Tell us what you were trying to do and what got in the way. Include versions and safe reproduction steps for bugs; keep private prompts, credentials and full logs out of reports.

You can still explore the source and make your own fork. See the [contribution policy](CONTRIBUTING.md), [Code of Conduct](CODE_OF_CONDUCT.md) and [private security-reporting guidance](SECURITY.md#reporting-a-vulnerability).

## Documentation

[Sidebar](docs/SIDEBAR_NAVIGATION.md) · [Composer](docs/COMPOSER_SETTINGS.md) · [Conversation](docs/CONVERSATION_SETTINGS.md) · [Usage](docs/USAGE_REMAINING.md)<br>
[Installation & recovery](docs/INSTALLATION.md) · [Local development](CONTRIBUTING.md#development-setup) · [Build audit](docs/NATIVE_DROPDOWNS_8881.md) · [Changelog](CHANGELOG.md)

---

Independent community project. Not affiliated with or endorsed by OpenAI.

[MIT](LICENSE) © ellisjpeg · [Third-party notices](THIRD_PARTY_NOTICES.md) · [CI](https://github.com/ellisjpeg/codex-workflow/actions/workflows/ci.yml)
