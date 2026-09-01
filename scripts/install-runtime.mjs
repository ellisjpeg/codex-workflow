import { join } from "node:path";
import {
  completeTransaction,
  createTransaction,
  embeddedFileHash,
  fileHash,
  installRuntimeFiles,
  installUpdaterAgent,
  patchVersion,
  pendingTransaction,
  preflight,
  readPatchState,
  resolveSourceBackup,
  restoreRuntimeFiles,
  runtimeRoot,
  setTransactionPhase,
  sourceRoot,
  writePatchState,
} from "./lib.mjs";

const dryRun = process.argv.includes("--dry-run");

if (pendingTransaction()) {
  throw new Error("An incomplete Workflow patch transaction exists; run recovery before continuing");
}

const current = preflight();
const metadata = current.pkg.__codexWorkflow;
if (current.pkg.main !== "workflow-loader.cjs" || !metadata) {
  throw new Error("Workflow is not installed");
}
resolveSourceBackup(metadata.source);
if (embeddedFileHash("workflow-loader.cjs") !== fileHash(join(sourceRoot, "loader.cjs"))) {
  throw new Error("This Workflow update changes the app loader and requires a guarded reapply");
}

if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    runtimeOnly: true,
    patchVersion,
    loaderVersion: metadata.version,
    runtimeRoot,
  }, null, 2));
  process.exit(0);
}

const warnings = current.signatureIsValid ? [] : ["pre-existing-app-signature-invalid"];
let transaction;
try {
  transaction = createTransaction();
  installRuntimeFiles();
  transaction = setTransactionPhase(transaction, "runtime-installed");
  const previous = readPatchState() || {};
  writePatchState({
    ...previous,
    schemaVersion: 2,
    patchVersion,
    loaderVersion: metadata.version,
    runtimeVersion: patchVersion,
    runtimeInstalledAt: new Date().toISOString(),
    source: metadata.source,
    installed: current.fingerprint,
  });
  completeTransaction(transaction);
  transaction = undefined;
  try {
    installUpdaterAgent();
  } catch {
    warnings.push("background-updater-install-failed");
  }
  console.log(JSON.stringify({
    ok: true,
    runtimeOnly: true,
    patchVersion,
    loaderVersion: metadata.version,
    runtimeRoot,
    warnings,
    restartRequired: true,
  }, null, 2));
} catch (error) {
  if (transaction) {
    restoreRuntimeFiles(transaction);
    completeTransaction(transaction);
  }
  throw error;
}
