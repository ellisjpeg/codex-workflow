import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  disabledPath,
  fileHash,
  pendingTransaction,
  patchVersion,
  preflight,
  readPatchState,
  readSettings,
  resolveSourceBackup,
  runtimeRoot,
  sourceRoot,
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
const runtimeReady = runtimeFiles.every((file) => file.present) && updateConfigPresent;
const runtimeCurrent = runtimeFiles.every((file) => file.matchesSource);
const sourceCurrent = current?.pkg.__codexWorkflow?.version === patchVersion;
const disabled = existsSync(disabledPath);
const action = pending
  ? recovery?.ready ? "recover" : "inspect-recovery"
  : error
    ? "inspect"
    : !patched
      ? versionSupported ? "install" : "install-with-version-review"
      : !runtimeReady || !sourceBackup.present
        ? "reapply-or-restore"
        : !sourceCurrent || !runtimeCurrent
          ? "reapply"
          : disabled
            ? "enable"
            : "none";

console.log(JSON.stringify({
  ok: !pending && !error && versionSupported && patched && runtimeReady && runtimeCurrent && sourceBackup.present && sourceCurrent && !disabled,
  recommendedAction: action,
  pendingTransaction: pending ? { id: pending.id, phase: pending.phase, recovery } : null,
  error: error || null,
  appVersion: current?.pkg.version || null,
  supportedVersion,
  sourcePatchVersion: patchVersion,
  sourceCurrent: Boolean(sourceCurrent),
  runtimeCurrent,
  enabled: !disabled,
  versionSupported: Boolean(versionSupported),
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
  settings: readSettings(),
  state: readPatchState(),
  signature: current ? {
    valid: current.signatureIsValid,
    warning: current.signatureIsValid ? null : "pre-existing-app-signature-invalid",
  } : null,
}, null, 2));
