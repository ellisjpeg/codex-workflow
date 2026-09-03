# Tool/MCP profiles

## Scope

This feature owns only `runtime/tool-mcp-profiles.cjs`, its focused tests, and this document. It does not modify the shared Workflow settings schema, renderer, preload, main runtime, package scripts, installer, or the live Codex application.

The module is deliberately pure and task-scoped. It compiles a profile against the tool catalog that is already enabled for the task, returns a deterministic allow-set plus MCP config overrides, and never writes global MCP/plugin configuration. A later shared integration hook can apply the result to one task request without changing another task or the machine-wide Codex config.

## Profile format

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "defaultProfileId": "code",
  "profiles": [
    {
      "id": "code",
      "selectors": [
        "tool:apply_patch",
        "mcp:github/get_issue"
      ]
    },
    {
      "id": "browser",
      "selectors": ["mcp:playwright/*"]
    },
    {
      "id": "minimal",
      "selectors": []
    }
  ]
}
```

Selectors are exact. `tool:<id>` selects one tool, `mcp:<server>/<tool>` selects one MCP tool, and `mcp:<server>/*` selects the currently enabled tools from one MCP server. No general globbing is accepted.

Unknown keys, duplicate IDs/selectors, malformed selectors, missing default profiles, unsupported schema versions, and missing selected tools make the feature return passthrough behavior rather than apply a partial profile.

## Safety contract

- Disabled mode returns no allow-list and no MCP config override, so current Codex behavior is unchanged.
- Profiles only narrow the catalog that the caller reports as currently enabled. Disabled tools cannot be re-enabled by a profile.
- The module never emits `mcp_servers.<name>.enabled = true`.
- Non-configurable tools, explicitly mandatory tools, and tools from a required MCP server are always preserved.
- If a selected tool/server is absent, the complete profile is rejected for that task and current behavior is restored.
- Task overrides are input to one pure resolution call. They do not mutate the configured default or any module state.
- Tool IDs are canonicalized only for the allow-set/cache key. The adapter filters the caller's existing tool array in place-order, avoiding unnecessary tool-schema reordering.
- MCP override conflicts fail atomically: the adapter returns the original tool catalog and original config overrides rather than partially applying the profile.
- Tool-schema byte counts are optional inventory metadata used only to report a deterministic before/after footprint; they never affect authorization.

## Current native evidence and deferred integration

The installed Codex build inspected for this feature accepts `enabled`, `enabled_tools`, `disabled_tools`, and `required` on MCP server definitions. Its local task request construction also carries a per-task config override object into the request. The bundled Codex app-tool MCP currently notes that Work has no direct per-task `enabled_tools` override of its own catalog, so the integration belongs at the native task request/tool-catalog boundary rather than in that MCP server or in global `config.toml`.

The deferred shared hook should:

1. Read the effective task tool catalog after native permissions, workspace policy, model capability, plugin availability, and machine config have already narrowed it.
2. Mark tools as `configurable`, `mandatory`, and `serverRequired` from the audited native contract; do not infer mandatory status from names.
3. Call `resolveToolProfile(...)` once when constructing the task request. A per-task override may select a different configured profile or explicit passthrough (`profileId: null`).
4. Call `applyToolProfilePlan(...)` with an audited stable ID mapper for the exact model-visible tool array and the request's existing config overrides.
5. On any non-`ok` result, send the original tool catalog/config unchanged and surface the profile failure as bounded diagnostic state. Do not retry with a partially filtered catalog.
6. Keep the selected profile/config machine-local. Do not write account-synced settings and do not mutate `$HOME/.codex/config.toml` for a task override.

The shared hook is intentionally not applied in this feature branch because `runtime/main.cjs`, `runtime/preload.cjs`, renderer synchronization, and shared settings/request plumbing are owned by adjacent work. The installed request path must be re-audited after a Codex build update before wiring this adapter into it.

## Cache behavior

`resolveToolProfile` returns a stable `cacheKey` derived from schema version, profile ID, sorted allowed tool IDs, and sorted MCP override keys. Equivalent inventories resolve to the same key even if discovery order differs. The integration adapter retains native tool-array order while filtering, so applying a stable profile does not churn schema order between tasks.

Changing profile/tool configuration mid-thread can still invalidate upstream prompt caches. The intended integration point is task creation or an explicit task override, not background profile switching.
