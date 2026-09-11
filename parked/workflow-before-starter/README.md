# Parked Workflow interface

The previous renderer is preserved here and is not loaded or packaged as runtime.
Its existing regression checks still run from `tests/preload.test.mjs`.
The starter renderer keeps the audited settings navigation, native primitives,
and existing main-process persistence. Earlier effects and controls are inactive.
Existing stored preferences are retained for later development.

To restore the prior interface in source, copy this renderer to `runtime/preload.cjs`
and return the regression harness to that source. Deployment remains a separate action.
