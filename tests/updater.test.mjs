import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.CODEX_WORKFLOW_ROOT = "/tmp/codex-workflow-updater-test";
const require = createRequire(import.meta.url);
const {
  automaticRepairDecision,
  applyAutomaticRepair,
  checkRemote,
  compareVersions,
  compatibilityMatches,
  eligibleReleaseCandidate,
  releaseVersionEligible,
  remoteBackoffMs,
  remoteCheckDue,
  selectStagedCandidate,
  sourcePackage,
  validateTarEntries,
  validateTarTypes,
  waitForProcessExit,
} = require("../runtime/updater.cjs");

function writeRelease(root, version = "0.5.4", {
  codexVersion = "26.901.20858",
  codexBuild = "7658",
} = {}) {
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({
    name: "codex-workflow",
    version,
  })}\n`);
  writeFileSync(join(root, "workflow-compatibility.json"), `${JSON.stringify({
    schemaVersion: 1,
    workflowVersion: version,
    codexVersion,
    codexBuild,
    bundleIdentifier: "com.openai.codex",
    packageName: "openai-codex-electron",
  })}\n`);
  for (const name of ["install.mjs", "install-runtime.mjs", "status.mjs"]) {
    writeFileSync(join(root, "scripts", name), "");
  }
}

test("updater compares canonical release versions", () => {
  assert.equal(compareVersions("0.5.0", "0.4.4"), 1);
  assert.equal(compareVersions("0.5.0", "0.5.0"), 0);
  assert.equal(compareVersions("0.4.4", "0.5.0"), -1);
  assert.equal(compareVersions("main", "0.5.0"), 0);
});

test("updater limits remote checks to five-minute intervals", () => {
  const now = Date.parse("2026-08-31T20:00:00.000Z");
  assert.equal(remoteCheckDue({}, now), true);
  assert.equal(remoteCheckDue({ remoteCheckedAt: "2026-08-31T19:56:00.001Z" }, now), false);
  assert.equal(remoteCheckDue({ remoteCheckedAt: "2026-08-31T19:55:00.000Z" }, now), true);
  assert.equal(remoteCheckDue({ nextRemoteCheckAt: "2026-08-31T20:00:01.000Z" }, now), false);
  assert.equal(remoteCheckDue({ nextRemoteCheckAt: "2026-08-31T20:00:00.000Z" }, now), true);
  assert.equal(remoteBackoffMs(1), 5 * 60 * 1000);
  assert.equal(remoteBackoffMs(2), 10 * 60 * 1000);
  assert.equal(remoteBackoffMs(9), 60 * 60 * 1000);
});

test("updater treats an absent parent process as already stopped", async () => {
  assert.equal(await waitForProcessExit(null, 1), true);
});

test("updater uses release ETags and accepts an unchanged response", async () => {
  const originalFetch = globalThis.fetch;
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-updater-etag-test-"));
  const releaseRoot = join(root, "updates", "0.5.4");
  writeRelease(releaseRoot);
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { status: 304, ok: false };
  };
  try {
    assert.deepEqual(
      await checkRemote(
        { releaseApi: "https://api.github.test/releases/latest" },
        {
          releaseEtag: '"release-1"',
          availableVersion: "0.5.4",
          stagedSourceRoot: releaseRoot,
        },
      ),
      { candidate: null, etag: '"release-1"', releaseVersion: "0.5.4", unchanged: true },
    );
    assert.equal(request.options.headers["If-None-Match"], '"release-1"');
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});

test("updater bypasses a stale ETag when its staged release is missing", async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { status: 404, ok: false };
  };
  try {
    await checkRemote(
      { releaseApi: "https://api.github.test/releases/latest" },
      { releaseEtag: '"release-1"', availableVersion: "0.5.4", stagedSourceRoot: null },
    );
    assert.equal(request.options.headers["If-None-Match"], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updater treats a repository without releases as up to date", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 404, ok: false });
  try {
    assert.deepEqual(
      await checkRemote({ releaseApi: "https://api.github.test/releases/latest" }, {}),
      { candidate: null, etag: null, releaseVersion: null, unchanged: false },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("updater selects only a matching staged release", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-updater-test-"));
  try {
    const releaseRoot = join(root, "updates", "0.5.4");
    writeRelease(releaseRoot);

    const compatibility = {
      schemaVersion: 1,
      workflowVersion: "0.5.4",
      codexVersion: "26.901.20858",
      codexBuild: "7658",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    };

    assert.deepEqual(
      selectStagedCandidate({
        availableVersion: "0.5.4",
        stagedSourceRoot: releaseRoot,
      }, "0.5.3"),
      {
        root: releaseRoot,
        version: "0.5.4",
        installPath: join(releaseRoot, "scripts", "install.mjs"),
        runtimeInstallPath: join(releaseRoot, "scripts", "install-runtime.mjs"),
        statusPath: join(releaseRoot, "scripts", "status.mjs"),
        compatibility,
      },
    );
    assert.equal(selectStagedCandidate({ sourceRoot: releaseRoot }, "0.5.3"), null);
    assert.equal(selectStagedCandidate({
      availableVersion: "0.5.5",
      stagedSourceRoot: releaseRoot,
    }, "0.5.3"), null);
    assert.equal(selectStagedCandidate({
      availableVersion: "0.5.4",
      stagedSourceRoot: releaseRoot,
    }, "0.5.3", {
      version: "26.901.20858",
      build: "7659",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic repair is exact-build guarded and attempted once", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-auto-repair-test-"));
  try {
    writeRelease(root, "0.5.11");
    const candidate = sourcePackage(root);
    const identity = {
      version: "26.901.20858",
      build: "7658",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    };
    const status = {
      patched: false,
      recommendedAction: "install",
      pendingTransaction: null,
      error: null,
      integrity: { computed: "a".repeat(64) },
    };
    const decision = automaticRepairDecision(
      { autoRepairCodexUpdates: true }, candidate, identity, status, {},
    );
    assert.equal(decision.eligible, true);
    assert.equal(compatibilityMatches(candidate, identity), true);
    assert.equal(automaticRepairDecision(
      { autoRepairCodexUpdates: true },
      candidate,
      { ...identity, build: "7659" },
      status,
      {},
    ).reason, "no-compatible-release");
    assert.equal(automaticRepairDecision(
      { autoRepairCodexUpdates: true },
      candidate,
      identity,
      status,
      { automaticRepair: { key: decision.key, status: "failed" } },
    ).reason, "attempt-already-recorded");
    assert.equal(automaticRepairDecision(
      { autoRepairCodexUpdates: false }, candidate, identity, status, {},
    ).reason, "disabled");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("equal-version release repairs a verified stock app exactly once", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-auto-apply-test-"));
  try {
    writeRelease(root, "0.5.11");
    const candidate = sourcePackage(root);
    const installed = "0.5.11";
    const identity = {
      version: "26.901.20858",
      build: "7658",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    };
    const statuses = [{
      patched: false,
      recommendedAction: "install",
      pendingTransaction: null,
      error: null,
      integrity: { computed: "a".repeat(64) },
    }, {
      ok: true,
      patched: true,
      pendingTransaction: null,
      appVersion: identity.version,
      appBuild: identity.build,
      integrity: { matches: true },
      signature: { valid: true },
    }];
    const calls = [];
    const written = [];
    let state = {};
    const repairCandidate = eligibleReleaseCandidate(candidate, installed, identity, true);
    assert.equal(releaseVersionEligible(candidate.version, installed, true), true);
    assert.equal(repairCandidate, candidate);
    assert.equal(await applyAutomaticRepair(
      { autoRepairCodexUpdates: true, nodeExecutable: "/opt/node", appRoot: "/Applications/ChatGPT.app" },
      repairCandidate,
      identity,
      state,
      {
        inspectCandidateStatus: () => statuses.shift(),
        waitForBundleQuiescence: async () => true,
        readState: () => state,
        writeState(value) {
          state = value;
          written.push(value);
        },
        spawnSync(command, args) {
          calls.push({ command, args });
          return { status: 0, stdout: "", stderr: "" };
        },
      },
    ), true);
    assert.deepEqual(calls, [{
      command: "/opt/node",
      args: [candidate.installPath, "--auto-repair"],
    }, {
      command: "/usr/bin/open",
      args: ["/Applications/ChatGPT.app"],
    }]);
    assert.deepEqual(written.map((value) => value.automaticRepair.status), [
      "applying",
      "relaunched",
    ]);
    assert.equal(state.availableVersion, null);
    assert.equal(state.stagedSourceRoot, null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("equal-version release is not an ordinary update or a mismatched-build repair", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-equal-version-guard-test-"));
  try {
    writeRelease(root, "0.5.11");
    const candidate = sourcePackage(root);
    const identity = {
      version: "26.901.20858",
      build: "7658",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    };
    assert.equal(releaseVersionEligible(candidate.version, candidate.version, false), false);
    assert.equal(eligibleReleaseCandidate(candidate, candidate.version, identity, false), null);
    assert.equal(eligibleReleaseCandidate(
      candidate,
      candidate.version,
      { ...identity, build: "7659" },
      true,
    ), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed automatic repair records a non-looping stop without relaunch", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-auto-failure-test-"));
  try {
    writeRelease(root, "0.5.11");
    const candidate = sourcePackage(root);
    const identity = {
      version: "26.901.20858",
      build: "7658",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    };
    const status = {
      patched: false,
      recommendedAction: "install",
      pendingTransaction: null,
      error: null,
      integrity: { computed: "b".repeat(64) },
    };
    const calls = [];
    let state = {};
    await assert.rejects(applyAutomaticRepair(
      { autoRepairCodexUpdates: true, nodeExecutable: "/opt/node", appRoot: "/Applications/ChatGPT.app" },
      candidate,
      identity,
      state,
      {
        inspectCandidateStatus: () => status,
        waitForBundleQuiescence: async () => true,
        readState: () => state,
        writeState(value) { state = value; },
        spawnSync(command, args) {
          calls.push({ command, args });
          return { status: 1, stdout: "", stderr: "fixture install failed" };
        },
      },
    ), /fixture install failed/u);
    assert.equal(calls.length, 1);
    assert.equal(state.automaticRepair.status, "failed");
    assert.equal(automaticRepairDecision(
      { autoRepairCodexUpdates: true }, candidate, identity, status, state,
    ).reason, "attempt-already-recorded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release source requires its compatibility manifest", () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-manifest-test-"));
  try {
    writeRelease(root);
    assert.ok(sourcePackage(root));
    rmSync(join(root, "workflow-compatibility.json"));
    assert.equal(sourcePackage(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("updater rejects archive traversal", () => {
  assert.doesNotThrow(() => validateTarEntries("codex-workflow/package.json\ncodex-workflow/runtime/main.cjs\n"));
  assert.throws(() => validateTarEntries("../escape\n"), /unsafe path/u);
  assert.throws(() => validateTarEntries("/absolute/path\n"), /unsafe path/u);
});

test("updater rejects links and special archive entries", () => {
  assert.doesNotThrow(() => validateTarTypes("drwxr-xr-x root/wheel 0 directory\n-rw-r--r-- root/wheel 1 file\n"));
  assert.throws(() => validateTarTypes("lrwxr-xr-x root/wheel 0 link -> /tmp\n"), /unsupported entry type/u);
});
