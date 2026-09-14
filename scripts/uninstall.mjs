import {
  asarPath,
  assertAppNotRunning,
  atomicReplace,
  completeTransaction,
  createTransaction,
  infoPlistPath,
  pendingTransaction,
  preflight,
  preflightLiveUncached,
  recoverPendingTransaction,
  resolveSourceBackup,
  restoreAppleSignature,
  resignPatchedApp,
  setTransactionPhase,
  uninstallUpdaterAgent,
  writePatchState,
} from "./lib.mjs";

assertAppNotRunning();
if (pendingTransaction()) {
  throw new Error("An incomplete Workflow patch transaction exists; run recovery before uninstalling");
}
const current = preflight(undefined, undefined, { allowVersion: true });
if (current.pkg.main !== "workflow-loader.cjs" || !current.pkg.__codexWorkflow?.source) {
  throw new Error("The installed app is not a verified Workflow patch installation");
}

const source = current.pkg.__codexWorkflow.source;
const backup = resolveSourceBackup(source);
let transaction;
try {
  transaction = createTransaction();
  atomicReplace(backup.backupAsar, asarPath);
  transaction = setTransactionPhase(transaction, "asar-restored");
  atomicReplace(backup.backupPlist, infoPlistPath);
  transaction = setTransactionPhase(transaction, "plist-restored");
  restoreAppleSignature(backup.backupDir);
  // Restore native contents with a valid local signature. The installer changed
  // embedded executable signatures; an old resource seal alone cannot undo that.
  resignPatchedApp();
  const restored = preflightLiveUncached({ allowVersion: true });
  if (restored.fingerprint.asarSha256 !== source.asarSha256) {
    throw new Error("Restored ASAR hash does not match the verified source backup");
  }
  const patchState = {
    schemaVersion: 1,
    uninstalledAt: new Date().toISOString(),
    source,
  };
  completeTransaction(transaction);
  transaction = undefined;
  const warnings = [];
  try {
    writePatchState(patchState);
  } catch {
    warnings.push("state-write-failed");
  }
  try {
    uninstallUpdaterAgent();
  } catch {
    warnings.push("background-updater-remove-failed");
  }
  console.log(JSON.stringify({
    ok: true,
    recoveredPreviousTransaction: false,
    restoredVersion: restored.pkg.version,
    source,
    warnings,
    restartRequired: true,
  }, null, 2));
} catch (error) {
  if (transaction) {
    try {
      recoverPendingTransaction();
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "Workflow uninstall failed and automatic recovery failed");
    }
  }
  throw error;
}
