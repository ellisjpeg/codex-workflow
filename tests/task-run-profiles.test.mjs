import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  DEFAULT_TASK_RUN_PROFILE_STATE,
  TASK_RUN_PROFILES,
  createOptimisticTaskRunProfileUpdate,
  normaliseTaskRunProfileState,
  patchTaskRunProfileState,
  resolveTaskRunProfile,
} = require("../runtime/task-run-profiles.cjs");

function model(slug, efforts, { fast = false } = {}) {
  return {
    slug,
    supported_reasoning_levels: efforts.map((effort) => ({ effort })),
    service_tiers: fast ? [{ id: "fast" }] : [],
    additional_speed_tiers: [],
    default_service_tier: null,
  };
}

const enabled = { schemaVersion: 1, enabled: true, defaultTaskType: "routine" };

test("task/run profile state is versioned, canonical, and fail-closed", () => {
  assert.deepEqual(normaliseTaskRunProfileState(null), DEFAULT_TASK_RUN_PROFILE_STATE);
  assert.deepEqual(
    normaliseTaskRunProfileState({
      schemaVersion: 99,
      enabled: true,
      defaultTaskType: "review",
    }),
    DEFAULT_TASK_RUN_PROFILE_STATE,
  );
  const canonical = { schemaVersion: 1, enabled: true, defaultTaskType: "review" };
  assert.deepEqual(normaliseTaskRunProfileState(canonical), canonical);
  assert.deepEqual(normaliseTaskRunProfileState(normaliseTaskRunProfileState(canonical)), canonical);
});

test("state patches reject unknown keys and invalid task types", () => {
  assert.throws(
    () => patchTaskRunProfileState(enabled, { model: "gpt-5.6-sol" }),
    (error) => error.code === "invalid-state-patch",
  );
  assert.throws(
    () => patchTaskRunProfileState(enabled, { defaultTaskType: "mystery" }),
    (error) => error.code === "unknown-task-type",
  );
  assert.deepEqual(
    patchTaskRunProfileState(enabled, { defaultTaskType: "coding" }),
    { schemaVersion: 1, enabled: true, defaultTaskType: "coding" },
  );
});

test("profiles are deterministic and choose the documented model/effort/tool defaults", () => {
  assert.deepEqual(Object.keys(TASK_RUN_PROFILES), ["quick", "routine", "coding", "review", "architecture"]);
  const models = [
    model("gpt-5.6-luna", ["low", "medium"]),
    model("gpt-5.6-terra", ["medium", "high"]),
    model("gpt-5.6-sol", ["medium", "high", "xhigh", "max"], { fast: true }),
  ];
  const input = { state: enabled, taskType: "coding", models };
  const first = resolveTaskRunProfile(input);
  const second = resolveTaskRunProfile(input);
  assert.deepEqual(first, second);
  assert.deepEqual(first.runDefaults, {
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    speed: "fast",
    serviceTier: "fast",
    toolPolicy: "workspace",
    permissionProfileId: "auto",
  });
});

test("routine profiles fall back only to a stronger model", () => {
  const result = resolveTaskRunProfile({
    state: enabled,
    taskType: "routine",
    models: [model("gpt-5.6-sol", ["medium", "high"])],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.runDefaults.model, "gpt-5.6-sol");
  assert.deepEqual(result.adjustments, ["model-fallback:gpt-5.6-terra->gpt-5.6-sol"]);
});

test("missing requested effort escalates to the nearest stronger supported effort", () => {
  const result = resolveTaskRunProfile({
    state: enabled,
    taskType: "review",
    models: [model("gpt-5.6-sol", ["xhigh", "max"])],
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.runDefaults.reasoningEffort, "xhigh");
  assert.deepEqual(result.adjustments, ["effort-escalated:high->xhigh"]);

  const ultra = resolveTaskRunProfile({
    state: enabled,
    taskType: "architecture",
    models: [model("gpt-5.6-sol", ["ultra"])],
  });
  assert.equal(ultra.runDefaults.reasoningEffort, "ultra");
  assert.deepEqual(ultra.adjustments, ["effort-escalated:xhigh->ultra"]);
});

test("quality-sensitive profiles block instead of downgrading model or effort", () => {
  const missingSol = resolveTaskRunProfile({
    state: enabled,
    taskType: "architecture",
    models: [model("gpt-5.6-terra", ["xhigh", "max"])],
  });
  assert.equal(missingSol.status, "blocked");
  assert.equal(missingSol.reason, "quality-gate-unmet");
  assert.deepEqual(missingSol.qualityGate, {
    minimumModel: "gpt-5.6-sol",
    minimumEffort: "xhigh",
    sensitive: true,
  });

  assert.throws(
    () => resolveTaskRunProfile({
      state: enabled,
      taskType: "review",
      models: [model("gpt-5.6-sol", ["medium", "high"])],
      overrides: { reasoningEffort: "medium" },
    }),
    (error) => error.code === "quality-gate",
  );
  assert.throws(
    () => resolveTaskRunProfile({
      state: enabled,
      taskType: "coding",
      models: [model("gpt-5.6-terra", ["medium", "high"])],
      overrides: { model: "gpt-5.6-terra" },
    }),
    (error) => error.code === "quality-gate",
  );
});

test("read-only profiles cannot be widened and unknown combinations are rejected", () => {
  const sol = [model("gpt-5.6-sol", ["high", "xhigh", "max"], { fast: true })];
  assert.throws(
    () => resolveTaskRunProfile({
      state: enabled,
      taskType: "review",
      models: sol,
      overrides: { toolPolicy: "workspace" },
    }),
    (error) => error.code === "unsafe-tool-policy",
  );
  assert.throws(
    () => resolveTaskRunProfile({ state: enabled, taskType: "review", models: sol, overrides: { model: "custom" } }),
    (error) => error.code === "unknown-model",
  );
  assert.throws(
    () => resolveTaskRunProfile({ state: enabled, taskType: "review", models: sol, overrides: { speed: "turbo" } }),
    (error) => error.code === "unknown-speed",
  );
  assert.throws(
    () => resolveTaskRunProfile({ state: enabled, taskType: "mystery", models: sol }),
    (error) => error.code === "unknown-task-type",
  );
});

test("default Fast safely falls back to Standard, but an explicit unsupported Fast request is rejected", () => {
  const noFastSol = [model("gpt-5.6-sol", ["medium", "high", "xhigh", "max"])];
  const fallback = resolveTaskRunProfile({ state: enabled, taskType: "coding", models: noFastSol });
  assert.equal(fallback.status, "resolved");
  assert.equal(fallback.runDefaults.speed, "standard");
  assert.equal(fallback.runDefaults.serviceTier, null);
  assert.deepEqual(fallback.adjustments, ["speed-fallback:fast->standard"]);

  assert.throws(
    () => resolveTaskRunProfile({
      state: enabled,
      taskType: "coding",
      models: noFastSol,
      overrides: { speed: "fast" },
    }),
    (error) => error.code === "unsupported-combination",
  );
});

test("disabling profiles restores native run defaults without mutating them", () => {
  const nativeRunDefaults = {
    model: "native-current",
    reasoningEffort: "low",
    serviceTier: null,
    approvalPolicy: "on-request",
  };
  const snapshot = structuredClone(nativeRunDefaults);
  const result = resolveTaskRunProfile({
    state: { schemaVersion: 1, enabled: false, defaultTaskType: "architecture" },
    taskType: "architecture",
    models: [],
    nativeRunDefaults,
  });
  assert.equal(result.status, "native");
  assert.deepEqual(result.runDefaults, snapshot);
  assert.deepEqual(nativeRunDefaults, snapshot);
});

test("failed optimistic persistence rolls back the exact previous canonical state", async () => {
  const current = { schemaVersion: 1, enabled: false, defaultTaskType: "routine" };
  const update = createOptimisticTaskRunProfileUpdate(current, {
    enabled: true,
    defaultTaskType: "coding",
  });
  assert.deepEqual(update.optimistic, {
    schemaVersion: 1,
    enabled: true,
    defaultTaskType: "coding",
  });

  let visible = update.optimistic;
  try {
    await Promise.reject(new Error("IPC write failed"));
  } catch {
    visible = update.rollback();
  }
  assert.deepEqual(visible, current);
});

test("canonical IPC responses win after optimistic persistence succeeds", () => {
  const update = createOptimisticTaskRunProfileUpdate(enabled, { defaultTaskType: "coding" });
  const canonical = update.commit({ schemaVersion: 1, enabled: true, defaultTaskType: "review", ignored: true });
  assert.deepEqual(canonical, { schemaVersion: 1, enabled: true, defaultTaskType: "review" });
});

test("ambiguous model catalog rows fail closed", () => {
  assert.throws(
    () => resolveTaskRunProfile({
      state: enabled,
      taskType: "routine",
      models: [
        model("gpt-5.6-terra", ["medium"]),
        model("gpt-5.6-terra", ["medium", "high"]),
      ],
    }),
    (error) => error.code === "invalid-model-catalog",
  );
});
