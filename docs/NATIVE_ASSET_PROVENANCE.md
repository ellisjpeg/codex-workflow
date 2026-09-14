# Native assets in Workflow Alpha 1

Workflow does not include Codex's native composer HTML snapshot or the 20 unique
native SVG paths identified in the Alpha 1 provenance review. This applies to
both current and retained parked preloads. Regression fixtures use synthetic
geometry. Required Lucide/Feather notices remain in `THIRD_PARTY_NOTICES.md`.

The review compared captured geometry with 755 icons at the MIT-licensed
[Apps SDK UI revision 0f00143c](https://github.com/openai/apps-sdk-ui/tree/0f00143c7a639906f1621fe58e1b6be7b5bea46d).
No geometrically identical replacement was established for the 13 native SVG
groups. That result establishes neither infringement nor permission. The public
SDK licence was not assumed to cover unrelated desktop assets.

## Runtime behaviour

On audited Codex Desktop 26.908.40834, build 8881, Workflow uses its existing
renderer execution mechanism to read the local application's native SVG exports.
The reader accepts only the audited main/detached entrypoint and fixed local
modules. It calls each export's native initializer, then validates expected
viewBoxes, path counts, tags and attributes. External references are rejected.
No network source, arbitrary path or user-supplied script is accepted.

The cold-entry composer is Workflow-authored inert sample structure using the
installed application's CSS interfaces and locally obtained glyphs. It contains
the complete editor, permission, model, reasoning, microphone and voice preview.
A complete live composer clone still takes precedence. Sanitisation removes
editable state, identity references, attachments and keyboard tab stops.

If the audited exports cannot be obtained, Workflow logs the failure and leaves
the native app running. Future Codex versions require review of these module
bindings alongside the existing route, selector, preload and integrity checks.
An automated version watcher cannot grant that compatibility approval.

## Verification and limits

Cold Settings entry was tested with no native composer mounted. Matched native
screenshots of the rebuilt preview and the accepted original produced zero
changed pixels at wide and narrow widths in light and dark appearances. The
appearance comparison used render-only theme instrumentation; settings controls,
reload persistence, section reset and remount were exercised in the isolated app.
Reader tests cover lazy initialization, output constraints and unsafe input.

This describes the current release tree and payload. It does not relicense
Codex, grant permission for historical captures, rewrite repository history or
constitute independent legal clearance.
