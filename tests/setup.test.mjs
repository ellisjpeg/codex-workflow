import assert from "node:assert/strict";
import test from "node:test";
import { approvalAccepted, runSetup } from "../scripts/setup.mjs";

test("setup approval accepts clear short and long answers", () => {
  for (const value of ["y", "Y", "yes", " YES "]) assert.equal(approvalAccepted(value), true);
  for (const value of ["", "n", "no", "yeah"]) assert.equal(approvalAccepted(value), false);
});

function setupHooks(calls, action = "install") {
  return {
    print() {},
    readStatus: () => ({ recommendedAction: action, installedWorkflowVersion: "0.5.43" }),
    runChecks: () => calls.push("checks"),
    runDryRun: () => calls.push("dry-run"),
    // Fail before any developer staging operation could touch the machine.
    availablePort: () => assert.fail("public setup must not reserve a staging port"),
    prepareStaging: () => assert.fail("public setup must not prepare staging"),
    launchStaging: () => assert.fail("public setup must not launch staging"),
    cleanupStagingSession: () => assert.fail("public setup must not manage staging"),
    askForApproval: async (_signal, question) => {
      assert.match(question, /Codex.*app bundle.*signature/u);
      calls.push("approval");
      return true;
    },
    waitForProductionExit: async () => calls.push("wait"),
    applyInstall: () => calls.push("install"),
    verifyStatus: () => {
      calls.push("verify");
      return { ok: true, patched: true, pendingTransaction: null, installedWorkflowVersion: "0.5.43" };
    },
    openApp: () => { calls.push("open"); return { status: 0 }; },
  };
}

test("public install and reapply require approval and never open staging", async () => {
  for (const action of ["install", "reapply"]) {
    const calls = [];
    const result = await runSetup({}, setupHooks(calls, action));
    assert.equal(result.installed, true);
    assert.deepEqual(calls, ["checks", "dry-run", "approval", "wait", "install", "verify", "open"]);
  }
});

test("explicit --yes skips only approval, retaining all installation gates", async () => {
  const calls = [];
  const result = await runSetup({ assumeYes: true, autoRepair: true }, setupHooks(calls));
  assert.deepEqual(result, { ok: true, installed: true, autoRepairCodexUpdates: true });
  assert.deepEqual(calls, ["checks", "dry-run", "wait", "install", "verify", "open"]);
});

test("declined or interrupted approval never quits, installs or opens Codex", async () => {
  for (const action of ["install", "reapply"]) {
    const calls = [];
    const hooks = setupHooks(calls, action);
    hooks.askForApproval = async () => false;
    assert.equal((await runSetup({}, hooks)).reason, "declined");
    assert.deepEqual(calls, ["checks", "dry-run"]);
    calls.length = 0;
    hooks.askForApproval = async () => { throw new Error("Setup interrupted by SIGHUP"); };
    await assert.rejects(runSetup({}, hooks), /SIGHUP/u);
    assert.deepEqual(calls, ["checks", "dry-run"]);
  }
});

test("current, unsafe and failed-preflight states cannot reach installation", async () => {
  const calls = [];
  assert.equal((await runSetup({}, setupHooks(calls, "none"))).reason, "current");
  for (const action of ["recover", "inspect", "install-with-version-review"]) {
    await assert.rejects(runSetup({}, setupHooks(calls, action)), /Setup stopped safely/u);
  }
  assert.deepEqual(calls, []);
  const hooks = setupHooks(calls);
  hooks.runDryRun = () => { throw new Error("unsupported build"); };
  await assert.rejects(runSetup({ assumeYes: true }, hooks), /unsupported build/u);
  assert.deepEqual(calls, ["checks"]);
});

test("failed installation or verification never relaunches Codex", async () => {
  for (const stage of ["applyInstall", "verifyStatus"]) {
    const calls = [];
    const hooks = setupHooks(calls);
    hooks[stage] = () => { throw new Error("failed gate"); };
    await assert.rejects(runSetup({ assumeYes: true }, hooks), /failed gate/u);
    assert.ok(!calls.includes("open"));
  }
  const calls = [];
  const hooks = setupHooks(calls);
  hooks.verifyStatus = () => ({ ok: true, patched: true, pendingTransaction: { id: "incomplete" } });
  await assert.rejects(runSetup({ assumeYes: true }, hooks), /did not pass status verification/u);
  assert.ok(!calls.includes("open"));
});
