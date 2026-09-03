import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  applyToolProfilePlan,
  mergeToolProfileConfigOverrides,
  resolveToolProfile,
  validateToolProfileConfig,
} = require("../runtime/tool-mcp-profiles.cjs");

function config(defaultProfileId = "code") {
  return {
    schemaVersion: 1,
    enabled: true,
    defaultProfileId,
    profiles: [
      { id: "code", selectors: ["tool:patch", "mcp:github/get_issue"] },
      { id: "research", selectors: ["mcp:web/*"] },
      { id: "minimal", selectors: [] },
    ],
  };
}

function inventory() {
  return [
    {
      id: "exec",
      name: "exec_command",
      kind: "builtin",
      configurable: false,
      schemaBytes: 100,
    },
    {
      id: "patch",
      name: "apply_patch",
      kind: "builtin",
      configurable: true,
      mandatory: true,
      schemaBytes: 80,
    },
    {
      id: "github:get_issue",
      name: "get_issue",
      kind: "mcp",
      server: "github",
      schemaBytes: 60,
    },
    {
      id: "github:create_issue",
      name: "create_issue",
      kind: "mcp",
      server: "github",
      schemaBytes: 70,
    },
    {
      id: "web:search",
      name: "search",
      kind: "mcp",
      server: "web",
      schemaBytes: 50,
    },
  ];
}

test("validates profile definitions strictly", () => {
  assert.equal(validateToolProfileConfig(config()).ok, true);
  assert.deepEqual(validateToolProfileConfig({ ...config(), extra: true }), {
    ok: false,
    error: "config contains unknown keys",
  });
  assert.equal(validateToolProfileConfig({
    ...config(),
    profiles: [{ id: "bad", selectors: ["mcp:github/**"] }],
    defaultProfileId: "bad",
  }).ok, false);
  assert.equal(validateToolProfileConfig({
    ...config(),
    profiles: [{ id: "bad", selectors: ["tool:patch*"] }],
    defaultProfileId: "bad",
  }).ok, false);
  assert.equal(validateToolProfileConfig({
    ...config(),
    profiles: [{ id: "bad", selectors: ["mcp:github/get*"] }],
    defaultProfileId: "bad",
  }).ok, false);
});

test("disabled mode is an exact passthrough", () => {
  const plan = resolveToolProfile({
    config: { ...config(), enabled: false },
    inventory: inventory(),
  });
  assert.equal(plan.applied, false);
  assert.equal(plan.reason, "disabled");
  assert.equal(plan.allowedToolIds, null);
  assert.equal(plan.mcpConfigOverrides, null);
});

test("profile selection is deterministic, least privilege, and preserves mandatory tools", () => {
  const first = resolveToolProfile({ config: config(), inventory: inventory() });
  const second = resolveToolProfile({ config: config(), inventory: [...inventory()].reverse() });

  assert.equal(first.applied, true);
  assert.deepEqual(first.allowedToolIds, ["exec", "github:get_issue", "patch"]);
  assert.deepEqual(first.mcpConfigOverrides, {
    "mcp_servers.github.enabled_tools": ["get_issue"],
    "mcp_servers.web.enabled": false,
  });
  assert.deepEqual(second.allowedToolIds, first.allowedToolIds);
  assert.deepEqual(second.mcpConfigOverrides, first.mcpConfigOverrides);
  assert.equal(second.cacheKey, first.cacheKey);
  assert.deepEqual(first.footprint, {
    beforeToolCount: 5,
    afterToolCount: 3,
    measuredToolCount: 5,
    beforeKnownBytes: 360,
    afterKnownBytes: 240,
    savedKnownBytes: 120,
  });
});

test("required MCP servers and non-configurable tools cannot be hidden", () => {
  const tools = inventory();
  tools.push({
    id: "audit:check",
    name: "check",
    kind: "mcp",
    server: "audit",
    serverRequired: true,
  });
  tools.push({
    id: "audit:report",
    name: "report",
    kind: "mcp",
    server: "audit",
    serverRequired: true,
  });
  const plan = resolveToolProfile({ config: config("minimal"), inventory: tools });
  assert.deepEqual(plan.allowedToolIds, ["audit:check", "audit:report", "exec", "patch"]);
  assert.equal(Object.keys(plan.mcpConfigOverrides).some((key) => key.includes("audit")), false);
});

test("a profile never re-enables a currently disabled tool", () => {
  const tools = inventory().map((tool) => (
    tool.id === "github:get_issue" ? { ...tool, enabled: false } : tool
  ));
  const plan = resolveToolProfile({ config: config(), inventory: tools });
  assert.equal(plan.applied, false);
  assert.equal(plan.reason, "missing-selector");
  assert.deepEqual(plan.missingSelectors, ["mcp:github/get_issue"]);
  assert.equal(plan.mcpConfigOverrides, null);
});

test("missing and invalid profiles restore current behavior", () => {
  assert.equal(resolveToolProfile({
    config: { ...config(), defaultProfileId: "missing" },
    inventory: inventory(),
  }).reason, "invalid-config");
  assert.equal(resolveToolProfile({
    config: config(),
    inventory: inventory(),
    taskOverride: { profileId: "missing" },
  }).reason, "missing-profile");
  assert.equal(resolveToolProfile({
    config: config(),
    inventory: inventory(),
    taskOverride: { profileId: "code", extra: true },
  }).reason, "invalid-task-override");
});

test("task overrides are ephemeral and do not leak into later resolutions", () => {
  const overridePlan = resolveToolProfile({
    config: config(),
    inventory: inventory(),
    taskOverride: { profileId: "research" },
  });
  const defaultPlan = resolveToolProfile({ config: config(), inventory: inventory() });

  assert.equal(overridePlan.profileId, "research");
  assert.deepEqual(overridePlan.allowedToolIds, ["exec", "patch", "web:search"]);
  assert.equal(defaultPlan.profileId, "code");
  assert.deepEqual(defaultPlan.allowedToolIds, ["exec", "github:get_issue", "patch"]);
});

test("config override merge refuses conflicting permission state", () => {
  const plan = resolveToolProfile({ config: config(), inventory: inventory() });
  const existing = { "mcp_servers.web.enabled": true, model_reasoning_effort: "high" };
  const merged = mergeToolProfileConfigOverrides(existing, plan);
  assert.equal(merged.ok, false);
  assert.equal(merged.reason, "config-conflict");
  assert.equal(merged.conflictKey, "mcp_servers.web.enabled");
  assert.strictEqual(merged.configOverrides, existing);
  assert.deepEqual(existing, { "mcp_servers.web.enabled": true, model_reasoning_effort: "high" });
});

test("feature-owned adapter applies tool and MCP narrowing atomically", () => {
  const plan = resolveToolProfile({ config: config(), inventory: inventory() });
  const schemas = inventory().map((tool) => ({ wireId: tool.id }));
  const existingConfig = { model_reasoning_effort: "high" };
  const result = applyToolProfilePlan({
    tools: schemas,
    plan,
    getToolId: (tool) => tool.wireId,
    existingConfigOverrides: existingConfig,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.tools.map((tool) => tool.wireId), ["exec", "patch", "github:get_issue"]);
  assert.deepEqual(result.configOverrides, {
    model_reasoning_effort: "high",
    "mcp_servers.github.enabled_tools": ["get_issue"],
    "mcp_servers.web.enabled": false,
  });
  assert.deepEqual(existingConfig, { model_reasoning_effort: "high" });
});

test("feature-owned adapter restores the original catalog on mapping or config errors", () => {
  const plan = resolveToolProfile({ config: config(), inventory: inventory() });
  const schemas = inventory().map((tool) => ({ wireId: tool.id }));

  const missing = applyToolProfilePlan({
    tools: schemas.filter((tool) => tool.wireId !== "exec"),
    plan,
    getToolId: (tool) => tool.wireId,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "tool-catalog-mismatch");

  const conflictConfig = { "mcp_servers.web.enabled": true };
  const conflict = applyToolProfilePlan({
    tools: schemas,
    plan,
    getToolId: (tool) => tool.wireId,
    existingConfigOverrides: conflictConfig,
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.reason, "config-conflict");
  assert.strictEqual(conflict.tools, schemas);
  assert.strictEqual(conflict.configOverrides, conflictConfig);
});
