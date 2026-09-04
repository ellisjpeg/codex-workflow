import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const updaterRuntimeRoot = "/tmp/codex-workflow-updater-test";
process.env.CODEX_WORKFLOW_ROOT = updaterRuntimeRoot;
const require = createRequire(import.meta.url);
const {
  automaticRepairDecision,
  automaticRepairWaitState,
  applyAutomaticRepair,
  checkRemote,
  compareVersions,
  compatibilityMatches,
  eligibleReleaseCandidate,
  nextAutomaticRepairState,
  notifyRepairRequired,
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

test("auto repair reacquires a source-less equal-version release", async () => {
  const originalFetch = globalThis.fetch;
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-updater-refetch-test-"));
  const releaseRoot = join(root, "release");
  const archive = join(root, "codex-workflow-0.5.11.tar.gz");
  const releaseApi = "https://api.github.test/releases/latest";
  const assetUrl = "https://downloads.github.test/codex-workflow-0.5.11.tar.gz";
  writeRelease(releaseRoot, "0.5.11");
  const packed = spawnSync("/usr/bin/tar", ["-czf", archive, "-C", releaseRoot, "."], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  const archiveBytes = readFileSync(archive);
  const digest = createHash("sha256").update(archiveBytes).digest("hex");
  rmSync(updaterRuntimeRoot, { recursive: true, force: true });
  mkdirSync(join(updaterRuntimeRoot, "runtime"), { recursive: true });
  writeFileSync(join(updaterRuntimeRoot, "runtime", "version.json"), '{"version":"0.5.11"}\n');
  let releaseRequest;
  globalThis.fetch = async (url, options) => {
    if (url === releaseApi) {
      releaseRequest = { url, options };
      if (options.headers["If-None-Match"]) return { status: 304, ok: false };
      return {
        status: 200,
        ok: true,
        headers: { get: (name) => name === "etag" ? '"release-1"' : null },
        json: async () => ({
          tag_name: "v0.5.11",
          assets: [{
            name: "codex-workflow-0.5.11.tar.gz",
            browser_download_url: assetUrl,
            digest: `sha256:${digest}`,
          }],
        }),
      };
    }
    assert.equal(url, assetUrl);
    return { status: 200, ok: true, arrayBuffer: async () => archiveBytes };
  };
  try {
    const result = await checkRemote(
      { releaseApi, autoRepairCodexUpdates: true },
      {
        releaseEtag: '"release-1"',
        releaseVersion: "0.5.11",
        stagedSourceRoot: null,
      },
    );
    assert.equal(releaseRequest.options.headers["If-None-Match"], undefined);
    assert.equal(result.candidate?.version, "0.5.11");
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(updaterRuntimeRoot, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
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

test("a replaced Codex build records and notifies one repair wait state", () => {
  const config = { autoRepairCodexUpdates: true };
  const identity = {
    version: "26.901.31953",
    build: "7868",
    bundleIdentifier: "com.openai.codex",
    packageName: "openai-codex-electron",
  };
  const patchState = { installed: { version: "26.901.20858", build: "7658" } };
  const waiting = automaticRepairWaitState(
    config,
    null,
    identity,
    patchState,
    {},
    new Date("2026-09-04T20:00:00.000Z"),
  );
  assert.deepEqual(waiting, {
    key: "awaiting-compatible-release:26.901.31953:7868",
    status: "awaiting-compatible-release",
    reason: "no-compatible-release",
    appVersion: "26.901.31953",
    appBuild: "7868",
    updatedAt: "2026-09-04T20:00:00.000Z",
  });
  assert.equal(automaticRepairWaitState(
    config,
    null,
    identity,
    patchState,
    { automaticRepair: waiting },
  ), null);
  assert.equal(nextAutomaticRepairState(
    config,
    null,
    identity,
    { installed: { version: identity.version, build: identity.build } },
    { automaticRepair: waiting },
  ), null);
  assert.equal(nextAutomaticRepairState(config, waiting, identity, patchState, {}), waiting);
  assert.equal(nextAutomaticRepairState(
    { autoRepairCodexUpdates: false },
    null,
    identity,
    patchState,
    { automaticRepair: waiting },
  ), null);
  assert.equal(automaticRepairWaitState(config, {}, identity, patchState, {}), null);
  assert.equal(automaticRepairWaitState(
    config,
    null,
    identity,
    { installed: { version: identity.version, build: identity.build } },
    {},
  ), null);

  const calls = [];
  assert.equal(notifyRepairRequired((command, args, options) => {
    calls.push({ command, args, options });
    return { status: 0 };
  }), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/usr/bin/osascript");
  assert.match(calls[0].args[1], /waiting for a compatible verified repair/u);
  assert.equal(calls[0].options.timeout, 5000);
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
      installedWorkflowVersion: candidate.version,
      loaderCurrent: true,
      runtimeCurrent: true,
      sourceCurrent: true,
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

test("automatic repair refuses stale installed hashes before relaunch", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-auto-hashes-test-"));
  try {
    writeRelease(root, "0.5.11");
    const candidate = sourcePackage(root);
    const identity = {
      version: candidate.compatibility.codexVersion,
      build: candidate.compatibility.codexBuild,
      bundleIdentifier: candidate.compatibility.bundleIdentifier,
      packageName: candidate.compatibility.packageName,
    };
    for (const mismatch of [
      { installedWorkflowVersion: "0.5.10" },
      { loaderCurrent: false },
      { runtimeCurrent: false },
      { sourceCurrent: false },
    ]) {
      let state = {};
      let calls = 0;
      let inspections = 0;
      await assert.rejects(applyAutomaticRepair(
        { autoRepairCodexUpdates: true, nodeExecutable: "/opt/node" },
        candidate, identity, state,
        {
          inspectCandidateStatus: () => inspections++ === 0
            ? { patched: false, recommendedAction: "install", integrity: { computed: "fixture" } }
            : {
              ok: true, patched: true, appVersion: identity.version, appBuild: identity.build,
              integrity: { matches: true }, signature: { valid: true },
              installedWorkflowVersion: candidate.version,
              loaderCurrent: true, runtimeCurrent: true, sourceCurrent: true,
              ...mismatch,
            },
          waitForBundleQuiescence: async () => true,
          readState: () => state,
          writeState: (value) => { state = value; },
          spawnSync: () => { calls += 1; return { status: 0 }; },
        },
      ), /installed hash, integrity, and signature verification/u);
      assert.equal(calls, 1);
      assert.equal(state.automaticRepair.status, "failed");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("automatic repair does not rewrite the same quiescence wait state", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-workflow-auto-wait-test-"));
  try {
    writeRelease(root, "0.5.13", {
      codexVersion: "26.901.31953",
      codexBuild: "7868",
    });
    const candidate = sourcePackage(root);
    const identity = {
      version: "26.901.31953",
      build: "7868",
      bundleIdentifier: "com.openai.codex",
      packageName: "openai-codex-electron",
    };
    const status = {
      patched: false,
      recommendedAction: "install",
      pendingTransaction: null,
      error: null,
      integrity: { computed: "c".repeat(64) },
    };
    const decision = automaticRepairDecision(
      { autoRepairCodexUpdates: true }, candidate, identity, status, {},
    );
    const previousState = {
      automaticRepair: { key: decision.key, status: "waiting" },
    };
    let writes = 0;
    assert.equal(await applyAutomaticRepair(
      { autoRepairCodexUpdates: true },
      candidate,
      identity,
      previousState,
      {
        inspectCandidateStatus: () => status,
        waitForBundleQuiescence: async () => false,
        writeState() { writes += 1; },
      },
    ), false);
    assert.equal(writes, 0);
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
    assert.equal(releaseVersionEligible("0.5.11-rc.1", candidate.version, true), false);
    assert.equal(releaseVersionEligible("0.5.11+other", candidate.version, true), false);
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
