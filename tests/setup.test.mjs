import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalAccepted,
  cleanupStagingSession,
  runSetup,
} from "../scripts/setup.mjs";

test("setup approval accepts clear short and long answers", () => {
  for (const value of ["y", "Y", "yes", " YES "]) assert.equal(approvalAccepted(value), true);
  for (const value of ["", "n", "no", "yeah"]) assert.equal(approvalAccepted(value), false);
});

test("setup performs one guarded staging and install lifecycle", async () => {
  const calls = [];
  const result = await runSetup({ assumeYes: true, autoRepair: true }, {
    print(message) { calls.push(["print", message]); },
    readStatus: () => ({ recommendedAction: "install" }),
    runChecks: () => calls.push(["checks"]),
    runDryRun: () => calls.push(["dry-run"]),
    availablePort: async () => 49258,
    prepareStaging: async () => ({ manifest: "/tmp/staging-manifest.json" }),
    launchStaging: async (_manifest, { signal }) => calls.push(["launch", signal]),
    cleanupStagingSession: async () => calls.push(["cleanup"]),
    waitForProductionExit: async () => calls.push(["wait"]),
    applyInstall: () => calls.push(["install"]),
    verifyStatus: () => ({
      ok: true,
      patched: true,
      pendingTransaction: null,
      installedWorkflowVersion: "0.5.11",
    }),
    openApp: () => {
      calls.push(["open"]);
      return { status: 0 };
    },
  });
  assert.deepEqual(result, {
    ok: true,
    installed: true,
    autoRepairCodexUpdates: true,
  });
  assert.equal(calls.filter(([name]) => name === "checks").length, 1);
  assert.equal(calls.filter(([name]) => name === "dry-run").length, 1);
  assert.equal(calls.filter(([name]) => name === "launch").length, 1);
  assert.equal(calls.filter(([name]) => name === "cleanup").length, 1);
  assert.equal(calls.filter(([name]) => name === "install").length, 1);
  assert.equal(calls.filter(([name]) => name === "open").length, 1);
});

test("setup interruption still cleans its prepared staging root", async () => {
  const calls = [];
  await assert.rejects(runSetup({}, {
    print() {},
    readStatus: () => ({ recommendedAction: "install" }),
    runChecks() {},
    runDryRun() {},
    availablePort: async () => 49258,
    prepareStaging: async () => ({ manifest: "/tmp/staging-manifest.json" }),
    launchStaging: async () => { throw new Error("Setup interrupted by SIGHUP"); },
    cleanupStagingSession: async () => calls.push("cleanup"),
  }), /SIGHUP/u);
  assert.deepEqual(calls, ["cleanup"]);
});

test("staging cleanup stops before restore and removal", async () => {
  const calls = [];
  let state = { status: "running", processId: 42 };
  await cleanupStagingSession("/tmp/staging-manifest.json", {
    readState: () => state,
    async stop() {
      calls.push("stop");
      state = { status: "stopped", processId: null };
    },
    restore() {
      calls.push("restore");
      state = { status: "restored", processId: null };
    },
    cleanup() {
      calls.push("cleanup");
      return { status: "removed" };
    },
  });
  assert.deepEqual(calls, ["stop", "restore", "cleanup"]);
});
