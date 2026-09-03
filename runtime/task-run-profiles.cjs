"use strict";

const TASK_RUN_PROFILE_STATE_SCHEMA_VERSION = 1;
const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const SPEEDS = ["standard", "fast"];
const TOOL_POLICIES = ["read-only", "workspace"];

const MODEL_TIERS = Object.freeze({
  "gpt-5.6-luna": 1,
  "gpt-5.6-terra": 2,
  "gpt-5.6-sol": 3,
});

const TASK_RUN_PROFILES = Object.freeze({
  quick: Object.freeze({
    model: "gpt-5.6-luna",
    reasoningEffort: "low",
    speed: "standard",
    toolPolicy: "read-only",
    fallbackModels: Object.freeze(["gpt-5.6-terra", "gpt-5.6-sol"]),
    qualityGate: Object.freeze({ minimumModel: "gpt-5.6-luna", minimumEffort: "low", sensitive: false }),
  }),
  routine: Object.freeze({
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    speed: "standard",
    toolPolicy: "workspace",
    fallbackModels: Object.freeze(["gpt-5.6-sol"]),
    qualityGate: Object.freeze({ minimumModel: "gpt-5.6-terra", minimumEffort: "medium", sensitive: false }),
  }),
  coding: Object.freeze({
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    speed: "fast",
    toolPolicy: "workspace",
    fallbackModels: Object.freeze([]),
    qualityGate: Object.freeze({ minimumModel: "gpt-5.6-sol", minimumEffort: "medium", sensitive: true }),
  }),
  review: Object.freeze({
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    speed: "standard",
    toolPolicy: "read-only",
    fallbackModels: Object.freeze([]),
    qualityGate: Object.freeze({ minimumModel: "gpt-5.6-sol", minimumEffort: "high", sensitive: true }),
  }),
  architecture: Object.freeze({
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    speed: "standard",
    toolPolicy: "read-only",
    fallbackModels: Object.freeze([]),
    qualityGate: Object.freeze({ minimumModel: "gpt-5.6-sol", minimumEffort: "xhigh", sensitive: true }),
  }),
});

const DEFAULT_TASK_RUN_PROFILE_STATE = Object.freeze({
  schemaVersion: TASK_RUN_PROFILE_STATE_SCHEMA_VERSION,
  enabled: false,
  defaultTaskType: "routine",
});

class TaskRunProfileError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TaskRunProfileError";
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneState(value) {
  return {
    schemaVersion: value.schemaVersion,
    enabled: value.enabled,
    defaultTaskType: value.defaultTaskType,
  };
}

function normaliseTaskRunProfileState(value) {
  if (!isObject(value) || value.schemaVersion !== TASK_RUN_PROFILE_STATE_SCHEMA_VERSION) {
    return cloneState(DEFAULT_TASK_RUN_PROFILE_STATE);
  }
  return {
    schemaVersion: TASK_RUN_PROFILE_STATE_SCHEMA_VERSION,
    enabled: typeof value.enabled === "boolean"
      ? value.enabled
      : DEFAULT_TASK_RUN_PROFILE_STATE.enabled,
    defaultTaskType: Object.hasOwn(TASK_RUN_PROFILES, value.defaultTaskType)
      ? value.defaultTaskType
      : DEFAULT_TASK_RUN_PROFILE_STATE.defaultTaskType,
  };
}

function patchTaskRunProfileState(current, patch) {
  if (!isObject(patch)) {
    throw new TaskRunProfileError("invalid-state-patch", "Task/run profile state patch must be an object");
  }
  const unknown = Object.keys(patch).filter((key) => !["enabled", "defaultTaskType"].includes(key));
  if (unknown.length > 0) {
    throw new TaskRunProfileError("invalid-state-patch", `Unknown task/run profile state key: ${unknown[0]}`);
  }
  if (Object.hasOwn(patch, "enabled") && typeof patch.enabled !== "boolean") {
    throw new TaskRunProfileError("invalid-state-patch", "Task/run profile enabled must be a boolean");
  }
  if (Object.hasOwn(patch, "defaultTaskType") && !Object.hasOwn(TASK_RUN_PROFILES, patch.defaultTaskType)) {
    throw new TaskRunProfileError("unknown-task-type", `Unknown task type: ${String(patch.defaultTaskType)}`);
  }
  return normaliseTaskRunProfileState({ ...normaliseTaskRunProfileState(current), ...patch });
}

function createOptimisticTaskRunProfileUpdate(current, patch) {
  const previous = Object.freeze(normaliseTaskRunProfileState(current));
  const optimistic = Object.freeze(patchTaskRunProfileState(previous, patch));
  return Object.freeze({
    previous,
    optimistic,
    commit(persisted) {
      return normaliseTaskRunProfileState(persisted);
    },
    rollback() {
      return cloneState(previous);
    },
  });
}

function effortRank(effort) {
  return REASONING_EFFORTS.indexOf(effort);
}

function modelRank(model) {
  return MODEL_TIERS[model] || 0;
}

function modelSlug(value) {
  if (!isObject(value)) return null;
  const slug = value.slug ?? value.model;
  return typeof slug === "string" && slug.length > 0 ? slug : null;
}

function supportedEfforts(model) {
  const levels = model.supported_reasoning_levels ?? model.supportedReasoningLevels;
  if (!Array.isArray(levels)) return [];
  const efforts = [];
  for (const level of levels) {
    const effort = typeof level === "string" ? level : level?.effort;
    if (REASONING_EFFORTS.includes(effort) && !efforts.includes(effort)) efforts.push(effort);
  }
  return efforts;
}

function tierId(value) {
  if (typeof value === "string") return value;
  if (!isObject(value)) return null;
  const id = value.id ?? value.name;
  return typeof id === "string" ? id.toLowerCase() : null;
}

function supportsFast(model) {
  if (model.fastSupported === true) return true;
  const tiers = [
    ...(Array.isArray(model.service_tiers) ? model.service_tiers : []),
    ...(Array.isArray(model.serviceTiers) ? model.serviceTiers : []),
    ...(Array.isArray(model.additional_speed_tiers) ? model.additional_speed_tiers : []),
    ...(Array.isArray(model.additionalSpeedTiers) ? model.additionalSpeedTiers : []),
  ];
  const defaultTier = model.default_service_tier ?? model.defaultServiceTier;
  return tierId(defaultTier) === "fast" || tiers.some((tier) => tierId(tier) === "fast");
}

function indexModels(models) {
  if (!Array.isArray(models)) {
    throw new TaskRunProfileError("invalid-model-catalog", "Task/run profiles require a model catalog array");
  }
  const indexed = new Map();
  for (const model of models) {
    const slug = modelSlug(model);
    if (!slug) continue;
    if (indexed.has(slug)) {
      throw new TaskRunProfileError("invalid-model-catalog", `Model catalog repeats slug: ${slug}`);
    }
    indexed.set(slug, model);
  }
  return indexed;
}

function validateOverrides(overrides) {
  if (overrides === undefined) return {};
  if (!isObject(overrides)) {
    throw new TaskRunProfileError("invalid-override", "Task/run profile overrides must be an object");
  }
  const allowed = ["model", "reasoningEffort", "speed", "toolPolicy"];
  const unknown = Object.keys(overrides).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new TaskRunProfileError("invalid-override", `Unknown task/run profile override: ${unknown[0]}`);
  }
  if (overrides.model !== undefined && !Object.hasOwn(MODEL_TIERS, overrides.model)) {
    throw new TaskRunProfileError("unknown-model", `Task/run profiles do not recognise model: ${String(overrides.model)}`);
  }
  if (overrides.reasoningEffort !== undefined && !REASONING_EFFORTS.includes(overrides.reasoningEffort)) {
    throw new TaskRunProfileError("unknown-reasoning-effort", `Unknown reasoning effort: ${String(overrides.reasoningEffort)}`);
  }
  if (overrides.speed !== undefined && !SPEEDS.includes(overrides.speed)) {
    throw new TaskRunProfileError("unknown-speed", `Unknown run speed: ${String(overrides.speed)}`);
  }
  if (overrides.toolPolicy !== undefined && !TOOL_POLICIES.includes(overrides.toolPolicy)) {
    throw new TaskRunProfileError("unsafe-tool-policy", `Unsupported task/run tool policy: ${String(overrides.toolPolicy)}`);
  }
  return { ...overrides };
}

function enforceQualityGate(profile, desired) {
  const gate = profile.qualityGate;
  if (modelRank(desired.model) < modelRank(gate.minimumModel)) {
    throw new TaskRunProfileError(
      "quality-gate",
      `${desired.model} is below the ${gate.minimumModel} quality floor for this task type`,
    );
  }
  if (effortRank(desired.reasoningEffort) < effortRank(gate.minimumEffort)) {
    throw new TaskRunProfileError(
      "quality-gate",
      `${desired.reasoningEffort} reasoning is below the ${gate.minimumEffort} quality floor for this task type`,
    );
  }
  if (profile.toolPolicy === "read-only" && desired.toolPolicy === "workspace") {
    throw new TaskRunProfileError(
      "unsafe-tool-policy",
      "A read-only task profile cannot be widened to workspace-write access",
    );
  }
}

function resolveEffort(model, requested) {
  const supported = supportedEfforts(model);
  if (supported.includes(requested)) return { effort: requested, escalated: false };
  const requestedRank = effortRank(requested);
  const stronger = supported
    .filter((effort) => effortRank(effort) > requestedRank)
    .sort((left, right) => effortRank(left) - effortRank(right));
  return stronger.length > 0 ? { effort: stronger[0], escalated: true } : null;
}

function permissionProfileId(toolPolicy) {
  return toolPolicy === "read-only" ? "read-only" : "auto";
}

function blockedResolution({ state, taskType, profile, desired, reason, adjustments }) {
  return {
    status: "blocked",
    source: "task-run-profile",
    state,
    taskType,
    reason,
    adjustments,
    requested: { ...desired },
    qualityGate: { ...profile.qualityGate },
  };
}

function resolveTaskRunProfile({
  state,
  taskType,
  models,
  nativeRunDefaults = {},
  overrides,
} = {}) {
  const canonicalState = normaliseTaskRunProfileState(state);
  if (!canonicalState.enabled) {
    if (!isObject(nativeRunDefaults)) {
      throw new TaskRunProfileError("invalid-native-defaults", "Native run defaults must be an object");
    }
    return {
      status: "native",
      source: "native",
      state: canonicalState,
      taskType: null,
      adjustments: [],
      runDefaults: { ...nativeRunDefaults },
    };
  }

  const selectedTaskType = taskType ?? canonicalState.defaultTaskType;
  if (!Object.hasOwn(TASK_RUN_PROFILES, selectedTaskType)) {
    throw new TaskRunProfileError("unknown-task-type", `Unknown task type: ${String(selectedTaskType)}`);
  }
  const profile = TASK_RUN_PROFILES[selectedTaskType];
  const safeOverrides = validateOverrides(overrides);
  const desired = {
    model: safeOverrides.model ?? profile.model,
    reasoningEffort: safeOverrides.reasoningEffort ?? profile.reasoningEffort,
    speed: safeOverrides.speed ?? profile.speed,
    toolPolicy: safeOverrides.toolPolicy ?? profile.toolPolicy,
  };
  enforceQualityGate(profile, desired);

  const catalog = indexModels(models);
  const candidates = safeOverrides.model === undefined
    ? [desired.model, ...profile.fallbackModels]
    : [desired.model];
  const adjustments = [];
  let selected = null;

  for (const candidate of candidates) {
    if (modelRank(candidate) < modelRank(profile.qualityGate.minimumModel)) continue;
    const model = catalog.get(candidate);
    if (!model) continue;
    const effort = resolveEffort(model, desired.reasoningEffort);
    if (!effort) continue;
    selected = { slug: candidate, model, effort };
    break;
  }

  if (!selected) {
    return blockedResolution({
      state: canonicalState,
      taskType: selectedTaskType,
      profile,
      desired,
      reason: safeOverrides.model === undefined ? "quality-gate-unmet" : "requested-model-unavailable",
      adjustments,
    });
  }

  if (selected.slug !== desired.model) {
    adjustments.push(`model-fallback:${desired.model}->${selected.slug}`);
  }
  if (selected.effort.escalated) {
    adjustments.push(`effort-escalated:${desired.reasoningEffort}->${selected.effort.effort}`);
  }

  let speed = desired.speed;
  if (speed === "fast" && !supportsFast(selected.model)) {
    if (safeOverrides.speed !== undefined) {
      throw new TaskRunProfileError(
        "unsupported-combination",
        `${selected.slug} does not advertise Fast mode in the current model catalog`,
      );
    }
    speed = "standard";
    adjustments.push("speed-fallback:fast->standard");
  }

  return {
    status: "resolved",
    source: "task-run-profile",
    state: canonicalState,
    taskType: selectedTaskType,
    adjustments,
    qualityGate: { ...profile.qualityGate },
    runDefaults: {
      model: selected.slug,
      reasoningEffort: selected.effort.effort,
      speed,
      serviceTier: speed === "fast" ? "fast" : null,
      toolPolicy: desired.toolPolicy,
      permissionProfileId: permissionProfileId(desired.toolPolicy),
    },
  };
}

module.exports = {
  DEFAULT_TASK_RUN_PROFILE_STATE,
  TASK_RUN_PROFILES,
  TASK_RUN_PROFILE_STATE_SCHEMA_VERSION,
  TaskRunProfileError,
  createOptimisticTaskRunProfileUpdate,
  normaliseTaskRunProfileState,
  patchTaskRunProfileState,
  resolveTaskRunProfile,
};
