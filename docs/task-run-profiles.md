# Task/run profiles — feature-owned slice

Status: policy module and focused tests implemented; shared runtime/UI/request integration intentionally deferred.

## Policy

`runtime/task-run-profiles.cjs` owns a small deterministic policy surface:

| Task type | Model | Effort | Speed | Permission boundary | Quality floor |
| --- | --- | --- | --- | --- | --- |
| `quick` | GPT-5.6 Luna | low | Standard | read-only | Luna / low |
| `routine` | GPT-5.6 Terra | medium | Standard | workspace (`auto`) | Terra / medium |
| `coding` | GPT-5.6 Sol | medium | Fast when advertised, otherwise Standard | workspace (`auto`) | Sol / medium |
| `review` | GPT-5.6 Sol | high | Standard | read-only | Sol / high |
| `architecture` | GPT-5.6 Sol | xhigh | Standard | read-only | Sol / xhigh |

Policy basis verified 2026-09-02 against current OpenAI model guidance: Sol is the flagship for complex professional/coding work, Terra balances intelligence and cost, Luna targets cost-sensitive/high-volume work, GPT-5.6 supports `none` through `ultra` reasoning, and Sol Fast mode changes latency rather than intelligence. The resolver still trusts the live Codex model catalog for actual per-run availability. It never assumes Fast exists when the current catalog does not advertise it.

The module does **not** define Tool/MCP profiles. `toolPolicy` only chooses between the current native permission-profile boundaries `read-only` and `auto`; it never expands tool inventories, MCP servers, network access, approval rules, or full-access permissions.

## Safety and fallback rules

- Profile definitions are static and deterministic.
- Persisted feature state is nested-schema version `1`, normalised to `{ schemaVersion, enabled, defaultTaskType }`, and defaults disabled.
- Unknown task types, models, efforts, speeds, state keys, and broader permission overrides are rejected.
- Fallback models only move upward in the GPT-5.6 family (`Luna -> Terra -> Sol`, `Terra -> Sol`). Sol quality-sensitive profiles never downgrade to Terra/Luna.
- If the requested effort is missing but a stronger effort is advertised, the resolver escalates to the nearest stronger effort. It never silently selects a weaker effort.
- A profile-default Fast request falls back to Standard when Fast is unavailable. An explicit unsupported Fast override is rejected.
- If no catalog row can meet the quality floor, resolution returns `status: "blocked"`; callers must not silently run a lower-quality profile.
- Disabled mode returns the supplied native run defaults unchanged by profile policy.
- `createOptimisticTaskRunProfileUpdate()` exposes a canonical optimistic state plus exact rollback/commit helpers for the existing renderer IPC pattern.

## Deferred integration hook points

These shared files were deliberately **not** edited in this feature task.

1. **Managed runtime payload — `scripts/lib.mjs`**
   - Add `runtime/task-run-profiles.cjs` to `managedRuntimePaths` near the current `main.cjs`, `preload.cjs`, and `updater.cjs` entries.
   - Copy it in `installRuntimeFiles()` using the same durable atomic replacement path.
   - Extend rollback/journal fixtures so the managed-file count and exact restoration remain proven.

2. **Main settings normalisation — `runtime/main.cjs`**
   - Require the module from `${CODEX_WORKFLOW_ROOT}/runtime/task-run-profiles.cjs` only after it is part of the managed runtime payload.
   - Add an optional nested `taskRunProfiles` key to `defaults` and `normaliseSettings()` via `normaliseTaskRunProfileState()` in the same place as current Workflow settings.
   - Keep the root settings schema at `2` if this remains a backward-compatible optional key; do not bump it without an actual root representation migration.
   - Reuse the existing atomic `settings:set` path rather than adding a second persistence store.

3. **Renderer state/UI — `runtime/preload.cjs`**
   - Mirror the nested normaliser in preload.
   - Add the enable/task-type controls to the existing Workflow page using current native control evidence.
   - Reuse the current `persistSetting()` optimistic pattern: snapshot previous canonical state, apply the staged value, disable controls while IPC is pending, commit the canonical response, and call `rollback()` on rejection.
   - When disabled, remove/ignore all profile-owned run overrides and show native values again.

4. **Native run construction — coordinator-owned request seam**
   - Current installed source constructs thread/turn requests with independent `model`, `effort`, and `serviceTier` fields, and resolves permission profiles into `approvalPolicy`/sandbox values before `startThread`/`startTurn`.
   - At the proven request-construction seam, call `resolveTaskRunProfile()` with the current live model catalog immediately before native run defaults are finalised.
   - Apply only `runDefaults.model`, `runDefaults.reasoningEffort` (native turn field `effort`), and `runDefaults.serviceTier` to the request.
   - Feed `runDefaults.permissionProfileId` back through Codex's existing permission-profile resolver. **Do not** translate it directly into raw sandbox/approval fields inside this module; native requirements/allowed profiles must remain authoritative.
   - If resolution is `blocked`, surface an explicit quality-gate failure and leave the task unstarted. If resolution is `native`, pass the original request through byte-for-byte/field-for-field.
   - Do not patch the minified installed bundle directly. The external-runtime seam must be proven first; until then this module must remain inert.

5. **Checks — `package.json` only when the coordinator owns shared integration**
   - The current `npm test` glob already discovers `tests/task-run-profiles.test.mjs`.
   - The current `npm run check` syntax list is explicit and does not include the new module, so add `node --check runtime/task-run-profiles.cjs` when the shared package script is next coordinated.

## Proven versus pending

Proven by the feature tests: deterministic resolution, schema normalisation, strict override validation, upward-only model fallback, reasoning escalation, Fast-to-Standard fallback, quality blocking, permission-boundary protection, disabled native pass-through, optimistic rollback, canonical commit, and ambiguous-catalog rejection.

Pending shared/live proof: Workflow UI controls, IPC persistence of the nested state, actual native thread/turn request interception, permission-profile resolution through native requirements, live model switching, remount behaviour, and installed-app end-to-end runs. No app bundle was changed by this feature.
