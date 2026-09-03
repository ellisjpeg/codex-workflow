"use strict";

const PROFILE_SCHEMA_VERSION = 1;
const MAX_PROFILES = 64;
const MAX_SELECTORS = 512;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MCP_SERVER_PATTERN = /^[A-Za-z0-9_-]{1,256}$/u;

function isPlainObject(value) {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isSafeToken(value, maxLength = 256) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    && !/[\u0000-\u001F\u007F\s]/u.test(value);
}

function parseSelector(selector) {
  if (!isSafeToken(selector, 600)) return null;
  if (selector.startsWith("tool:")) {
    const id = selector.slice(5);
    return isSafeToken(id, 512) && !id.includes("*") ? { type: "tool", id } : null;
  }
  if (!selector.startsWith("mcp:")) return null;
  const body = selector.slice(4);
  const slash = body.indexOf("/");
  if (slash <= 0 || slash === body.length - 1) return null;
  const server = body.slice(0, slash);
  const toolName = body.slice(slash + 1);
  if (!MCP_SERVER_PATTERN.test(server)) return null;
  if (toolName === "*") return { type: "mcp-server", server };
  if (!isSafeToken(toolName, 256) || toolName.includes("/") || toolName.includes("*")) return null;
  return { type: "mcp-tool", server, toolName };
}

function validateToolProfileConfig(input) {
  if (!isPlainObject(input)) return { ok: false, error: "config must be an object" };
  const configKeys = new Set(["schemaVersion", "enabled", "defaultProfileId", "profiles"]);
  if (!hasOnlyKeys(input, configKeys)) return { ok: false, error: "config contains unknown keys" };
  if (input.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported schemaVersion: ${String(input.schemaVersion)}` };
  }
  if (typeof input.enabled !== "boolean") return { ok: false, error: "enabled must be boolean" };
  if (!Array.isArray(input.profiles) || input.profiles.length > MAX_PROFILES) {
    return { ok: false, error: `profiles must contain at most ${MAX_PROFILES} entries` };
  }

  const profiles = [];
  const profileIds = new Set();
  for (const rawProfile of input.profiles) {
    if (!isPlainObject(rawProfile)) return { ok: false, error: "profile must be an object" };
    if (!hasOnlyKeys(rawProfile, new Set(["id", "selectors"]))) {
      return { ok: false, error: "profile contains unknown keys" };
    }
    if (typeof rawProfile.id !== "string" || !PROFILE_ID_PATTERN.test(rawProfile.id)) {
      return { ok: false, error: "profile id is invalid" };
    }
    if (profileIds.has(rawProfile.id)) return { ok: false, error: `duplicate profile id: ${rawProfile.id}` };
    if (!Array.isArray(rawProfile.selectors) || rawProfile.selectors.length > MAX_SELECTORS) {
      return { ok: false, error: `selectors must contain at most ${MAX_SELECTORS} entries` };
    }

    const selectors = [];
    const selectorStrings = new Set();
    for (const rawSelector of rawProfile.selectors) {
      const parsed = parseSelector(rawSelector);
      if (parsed == null) return { ok: false, error: `invalid selector in profile ${rawProfile.id}` };
      if (selectorStrings.has(rawSelector)) {
        return { ok: false, error: `duplicate selector in profile ${rawProfile.id}` };
      }
      selectorStrings.add(rawSelector);
      selectors.push({ raw: rawSelector, ...parsed });
    }
    profileIds.add(rawProfile.id);
    profiles.push({ id: rawProfile.id, selectors });
  }

  const defaultProfileId = input.defaultProfileId ?? null;
  if (defaultProfileId !== null && (!PROFILE_ID_PATTERN.test(defaultProfileId) || !profileIds.has(defaultProfileId))) {
    return { ok: false, error: "defaultProfileId does not name a configured profile" };
  }

  return {
    ok: true,
    value: {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      enabled: input.enabled,
      defaultProfileId,
      profiles,
    },
  };
}

function validateTaskOverride(input) {
  if (input == null) return { ok: true, value: null };
  if (!isPlainObject(input) || !hasOnlyKeys(input, new Set(["profileId"]))) {
    return { ok: false, error: "task override must contain only profileId" };
  }
  if (input.profileId !== null && (typeof input.profileId !== "string" || !PROFILE_ID_PATTERN.test(input.profileId))) {
    return { ok: false, error: "task override profileId is invalid" };
  }
  return { ok: true, value: { profileId: input.profileId } };
}

function normalizeInventory(input) {
  if (!Array.isArray(input)) return { ok: false, error: "inventory must be an array" };
  const ids = new Set();
  const mcpNames = new Set();
  const tools = [];

  for (const rawTool of input) {
    if (!isPlainObject(rawTool)) return { ok: false, error: "inventory tool must be an object" };
    if (!isSafeToken(rawTool.id, 512) || !isSafeToken(rawTool.name, 256)) {
      return { ok: false, error: "inventory tool id/name is invalid" };
    }
    if (rawTool.kind !== "builtin" && rawTool.kind !== "mcp") {
      return { ok: false, error: `unsupported tool kind: ${String(rawTool.kind)}` };
    }
    if (ids.has(rawTool.id)) return { ok: false, error: `duplicate tool id: ${rawTool.id}` };
    ids.add(rawTool.id);

    const enabled = rawTool.enabled ?? true;
    const configurable = rawTool.configurable ?? rawTool.kind === "mcp";
    const mandatory = rawTool.mandatory ?? false;
    const serverRequired = rawTool.serverRequired ?? false;
    if ([enabled, configurable, mandatory, serverRequired].some((value) => typeof value !== "boolean")) {
      return { ok: false, error: `tool flags must be boolean: ${rawTool.id}` };
    }
    if (mandatory && !enabled) return { ok: false, error: `mandatory tool is disabled: ${rawTool.id}` };

    let server = null;
    if (rawTool.kind === "mcp") {
      if (typeof rawTool.server !== "string" || !MCP_SERVER_PATTERN.test(rawTool.server)) {
        return { ok: false, error: `invalid MCP server for tool: ${rawTool.id}` };
      }
      server = rawTool.server;
      const serverToolKey = `${server}\u0000${rawTool.name}`;
      if (mcpNames.has(serverToolKey)) {
        return { ok: false, error: `duplicate MCP tool name: ${server}/${rawTool.name}` };
      }
      mcpNames.add(serverToolKey);
    } else if (rawTool.server != null || serverRequired) {
      return { ok: false, error: `builtin tool cannot declare MCP server state: ${rawTool.id}` };
    }

    let schemaBytes = null;
    if (rawTool.schemaBytes != null) {
      if (!Number.isSafeInteger(rawTool.schemaBytes) || rawTool.schemaBytes < 0) {
        return { ok: false, error: `schemaBytes must be a non-negative integer: ${rawTool.id}` };
      }
      schemaBytes = rawTool.schemaBytes;
    }

    tools.push({
      id: rawTool.id,
      name: rawTool.name,
      kind: rawTool.kind,
      server,
      enabled,
      configurable,
      mandatory,
      serverRequired,
      schemaBytes,
    });
  }

  return { ok: true, value: tools };
}

function selectorMatches(selector, tool) {
  if (selector.type === "tool") return tool.id === selector.id;
  if (tool.kind !== "mcp" || tool.server !== selector.server) return false;
  if (selector.type === "mcp-server") return true;
  return tool.name === selector.toolName;
}

function passthrough(reason, details = {}) {
  return {
    applied: false,
    reason,
    profileId: details.profileId ?? null,
    allowedToolIds: null,
    mcpConfigOverrides: null,
    cacheKey: null,
    footprint: null,
    missingSelectors: details.missingSelectors ?? [],
    error: details.error ?? null,
  };
}

function footprintFor(currentTools, allowedIds) {
  let beforeKnownBytes = 0;
  let afterKnownBytes = 0;
  let measuredToolCount = 0;
  for (const tool of currentTools) {
    if (tool.schemaBytes == null) continue;
    measuredToolCount += 1;
    beforeKnownBytes += tool.schemaBytes;
    if (allowedIds.has(tool.id)) afterKnownBytes += tool.schemaBytes;
  }
  return {
    beforeToolCount: currentTools.length,
    afterToolCount: allowedIds.size,
    measuredToolCount,
    beforeKnownBytes,
    afterKnownBytes,
    savedKnownBytes: beforeKnownBytes - afterKnownBytes,
  };
}

function stableObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}

function resolveToolProfile({ config, inventory, taskOverride = null }) {
  const validatedConfig = validateToolProfileConfig(config);
  if (!validatedConfig.ok) return passthrough("invalid-config", { error: validatedConfig.error });
  if (!validatedConfig.value.enabled) return passthrough("disabled");

  const validatedOverride = validateTaskOverride(taskOverride);
  if (!validatedOverride.ok) return passthrough("invalid-task-override", { error: validatedOverride.error });

  const profileId = validatedOverride.value == null
    ? validatedConfig.value.defaultProfileId
    : validatedOverride.value.profileId;
  if (profileId == null) return passthrough("no-profile");

  const profile = validatedConfig.value.profiles.find((candidate) => candidate.id === profileId);
  if (profile == null) return passthrough("missing-profile", { profileId });

  const validatedInventory = normalizeInventory(inventory);
  if (!validatedInventory.ok) {
    return passthrough("invalid-inventory", { profileId, error: validatedInventory.error });
  }
  const currentTools = validatedInventory.value.filter((tool) => tool.enabled);

  const missingSelectors = profile.selectors
    .filter((selector) => !currentTools.some((tool) => selectorMatches(selector, tool)))
    .map((selector) => selector.raw)
    .sort();
  if (missingSelectors.length > 0) {
    return passthrough("missing-selector", { profileId, missingSelectors });
  }

  const allowedIds = new Set();
  for (const tool of currentTools) {
    const forced = !tool.configurable || tool.mandatory || tool.serverRequired;
    const selected = profile.selectors.some((selector) => selectorMatches(selector, tool));
    if (forced || selected) allowedIds.add(tool.id);
  }

  const mcpByServer = new Map();
  for (const tool of currentTools) {
    if (tool.kind !== "mcp") continue;
    const bucket = mcpByServer.get(tool.server) ?? [];
    bucket.push(tool);
    mcpByServer.set(tool.server, bucket);
  }

  const mcpConfigOverrides = {};
  for (const [server, tools] of [...mcpByServer.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (tools.some((tool) => tool.serverRequired)) continue;
    const allowedTools = tools.filter((tool) => allowedIds.has(tool.id));
    if (allowedTools.length === 0) {
      mcpConfigOverrides[`mcp_servers.${server}.enabled`] = false;
      continue;
    }
    if (allowedTools.length < tools.length) {
      mcpConfigOverrides[`mcp_servers.${server}.enabled_tools`] = allowedTools
        .map((tool) => tool.name)
        .sort();
    }
  }

  const allowedToolIds = [...allowedIds].sort();
  const stableOverrides = stableObject(mcpConfigOverrides);
  return {
    applied: true,
    reason: "profile",
    profileId,
    allowedToolIds,
    mcpConfigOverrides: stableOverrides,
    cacheKey: `tool-profile/v${PROFILE_SCHEMA_VERSION}|${profileId}|${allowedToolIds.join(",")}|${JSON.stringify(stableOverrides)}`,
    footprint: footprintFor(currentTools, allowedIds),
    missingSelectors: [],
    error: null,
  };
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeToolProfileConfigOverrides(existingConfigOverrides, plan) {
  if (!isPlainObject(existingConfigOverrides)) {
    return { ok: false, reason: "invalid-existing-config", configOverrides: existingConfigOverrides };
  }
  if (plan == null || plan.applied !== true || plan.mcpConfigOverrides == null) {
    return { ok: true, reason: "passthrough", configOverrides: existingConfigOverrides };
  }

  for (const [key, value] of Object.entries(plan.mcpConfigOverrides)) {
    if (Object.prototype.hasOwnProperty.call(existingConfigOverrides, key)
      && !valuesEqual(existingConfigOverrides[key], value)) {
      return { ok: false, reason: "config-conflict", configOverrides: existingConfigOverrides, conflictKey: key };
    }
  }

  const merged = { ...existingConfigOverrides };
  for (const [key, value] of Object.entries(plan.mcpConfigOverrides)) merged[key] = value;
  return { ok: true, reason: "merged", configOverrides: merged };
}

function applyToolProfilePlan({ tools, plan, getToolId, existingConfigOverrides = {} }) {
  if (!Array.isArray(tools)) {
    return { ok: false, reason: "invalid-tool-catalog", tools, configOverrides: existingConfigOverrides };
  }
  if (plan == null || plan.applied !== true) {
    return { ok: true, reason: "passthrough", tools, configOverrides: existingConfigOverrides };
  }
  if (typeof getToolId !== "function") {
    return { ok: false, reason: "missing-tool-id-adapter", tools, configOverrides: existingConfigOverrides };
  }

  const allowedIds = new Set(plan.allowedToolIds);
  const seen = new Set();
  const filtered = [];
  for (const tool of tools) {
    let id;
    try {
      id = getToolId(tool);
    } catch {
      return { ok: false, reason: "tool-id-adapter-failed", tools, configOverrides: existingConfigOverrides };
    }
    if (!isSafeToken(id, 512) || seen.has(id)) {
      return { ok: false, reason: "tool-catalog-mismatch", tools, configOverrides: existingConfigOverrides };
    }
    seen.add(id);
    if (allowedIds.has(id)) filtered.push(tool);
  }
  if ([...allowedIds].some((id) => !seen.has(id))) {
    return { ok: false, reason: "tool-catalog-mismatch", tools, configOverrides: existingConfigOverrides };
  }

  const merged = mergeToolProfileConfigOverrides(existingConfigOverrides, plan);
  if (!merged.ok) {
    return {
      ok: false,
      reason: merged.reason,
      conflictKey: merged.conflictKey,
      tools,
      configOverrides: existingConfigOverrides,
    };
  }
  return { ok: true, reason: "applied", tools: filtered, configOverrides: merged.configOverrides };
}

module.exports = {
  PROFILE_SCHEMA_VERSION,
  applyToolProfilePlan,
  mergeToolProfileConfigOverrides,
  resolveToolProfile,
  validateToolProfileConfig,
};
