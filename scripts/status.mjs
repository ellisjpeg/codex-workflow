import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  disabledPath,
  embeddedFileHash,
  fileHash,
  pendingTransaction,
  patchVersion,
  preflight,
  readPatchState,
  readRuntimeVersion,
  readSettings,
  resolveSourceBackup,
  runtimeRoot,
  sourceRoot,
  supportedBuild,
  supportedVersion,
  transactionRecoveryStatus,
} from "./lib.mjs";

const runtimeFiles = ["main.cjs", "preload.cjs", "updater.cjs"].map((name) => {
  const installedPath = join(runtimeRoot, "runtime", name);
  const sourcePath = join(sourceRoot, "runtime", name);
  const present = existsSync(installedPath);
  let matchesSource = false;
  try {
    matchesSource = present && fileHash(installedPath) === fileHash(sourcePath);
  } catch {}
  return { name, present, matchesSource };
});
const updateConfigPresent = existsSync(join(runtimeRoot, "update-config.json"));
const readJson = (target) => {
  try {
    return JSON.parse(readFileSync(target, "utf8"));
  } catch {
    return null;
  }
};
const updateConfig = readJson(join(runtimeRoot, "update-config.json"));
const updateState = readJson(join(runtimeRoot, "update-state.json"));
let pending;
let pendingError;
try {
  pending = pendingTransaction();
} catch (reason) {
  pendingError = String(reason?.message || reason);
}
const recovery = pending ? transactionRecoveryStatus(pending) : null;
let current;
let preflightError;
try {
  current = preflight(undefined, undefined, { allowVersion: true });
} catch (reason) {
  preflightError = String(reason?.message || reason);
}
const error = pendingError || preflightError;

const patched = Boolean(current?.pkg.main === "workflow-loader.cjs" && current?.pkg.__codexWorkflow);
let sourceBackup = { present: false };
if (patched) {
  try {
    resolveSourceBackup(current.pkg.__codexWorkflow.source);
    sourceBackup = { present: true };
  } catch (reason) {
    sourceBackup = { present: false, error: String(reason?.message || reason) };
  }
}

const versionSupported = current?.pkg.version === supportedVersion;
const buildSupported = String(current?.pkg.codexBuildNumber || "unknown") === supportedBuild;
const runtimeReady = runtimeFiles.every((file) => file.present) && updateConfigPresent;
const runtimeCurrent = runtimeFiles.every((file) => file.matchesSource);
const state = readPatchState();
const installedWorkflowVersion = readRuntimeVersion() ||
  state?.runtimeVersion ||
  state?.patchVersion ||
  current?.pkg.__codexWorkflow?.version ||
  null;
let loaderCurrent = false;
try {
  loaderCurrent = patched &&
    embeddedFileHash("workflow-loader.cjs") === fileHash(join(sourceRoot, "loader.cjs"));
} catch {}
const sourceCurrent = installedWorkflowVersion === patchVersion;
const disabled = existsSync(disabledPath);
const action = pending
  ? recovery?.ready ? "recover" : "inspect-recovery"
  : error
    ? "inspect"
    : !patched
      ? versionSupported && buildSupported ? "install" : "install-with-version-review"
      : !versionSupported || !buildSupported
        ? "inspect"
        : !runtimeReady || !sourceBackup.present
          ? "reapply-or-restore"
          : !loaderCurrent || !sourceCurrent || !runtimeCurrent
            ? "reapply"
            : disabled
              ? "enable"
              : "none";

console.log(JSON.stringify({
  ok: !pending && !error && versionSupported && buildSupported && patched && runtimeReady && runtimeCurrent && sourceBackup.present && loaderCurrent && sourceCurrent && !disabled,
  recommendedAction: action,
  pendingTransaction: pending ? { id: pending.id, phase: pending.phase, recovery } : null,
  error: error || null,
  appVersion: current?.pkg.version || null,
  appBuild: current ? String(current.pkg.codexBuildNumber || "unknown") : null,
  supportedVersion,
  supportedBuild,
  sourcePatchVersion: patchVersion,
  installedWorkflowVersion,
  appPatchVersion: current?.pkg.__codexWorkflow?.version || null,
  sourceCurrent: Boolean(sourceCurrent),
  loaderCurrent,
  runtimeCurrent,
  enabled: !disabled,
  versionSupported: Boolean(versionSupported),
  buildSupported: Boolean(buildSupported),
  patched,
  patch: current?.pkg.__codexWorkflow || null,
  sourceBackup,
  integrity: current ? {
    matches: current.expectedIntegrity === current.computedIntegrity,
    expected: current.expectedIntegrity,
    computed: current.computedIntegrity,
  } : null,
  runtimeFiles,
  updateConfigPresent,
  autoRepairCodexUpdates: updateConfig?.autoRepairCodexUpdates === true,
  updateCheck: updateState ? {
    remoteCheckedAt: updateState.remoteCheckedAt || null,
    nextRemoteCheckAt: updateState.nextRemoteCheckAt || null,
    remoteFailureCount: Number(updateState.remoteFailureCount || 0),
    automaticRepair: updateState.automaticRepair || null,
  } : null,
  settings: readSettings(),
  state,
  signature: current ? {
    valid: current.signatureIsValid,
    warning: current.signatureIsValid ? null : "pre-existing-app-signature-invalid",
  } : null,
}, null, 2));
