import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appAsarSize,
  asarPath,
  assertAppNotRunning,
  atomicReplace,
  buildPatchedAsar,
  completeTransaction,
  createTransaction,
  ensureSourceBackup,
  headerHash,
  infoPlistPath,
  installRuntimeFiles,
  installUpdaterAgent,
  pendingTransaction,
  preflight,
  preflightLiveUncached,
  prettyBytes,
  readPackage,
  recoverPendingTransaction,
  resolveSourceBackup,
  runtimeRoot,
  setPlistValue,
  setTransactionPhase,
  writePatchState,
} from "./lib.mjs";

const allowVersion = process.argv.includes("--allow-version");
const dryRun = process.argv.includes("--dry-run");
const recoverOnly = process.argv.includes("--recover");
const reapply = process.argv.includes("--reapply");
const liveInstall = process.argv.includes("--live-install");

if (liveInstall) {
  throw new Error("--live-install is not supported; quit ChatGPT/Codex before applying the patch");
}

if (recoverOnly) {
  assertAppNotRunning();
  console.log(JSON.stringify({ ok: true, ...recoverPendingTransaction() }, null, 2));
  process.exit(0);
}

if (!dryRun) assertAppNotRunning();
const pending = pendingTransaction();
if (pending) {
  throw new Error("An incomplete Workflow patch transaction exists; run recovery before continuing");
}
const current = preflight(asarPath, infoPlistPath, { allowVersion });
const alreadyPatched = current.pkg.main === "workflow-loader.cjs" && Boolean(current.pkg.__codexWorkflow);
if (alreadyPatched && !reapply) {
  throw new Error("Workflow is already installed; use --reapply after reviewing the current source");
}
if (!alreadyPatched && reapply) {
  throw new Error("Workflow is not installed; use the normal install command");
}
const source = alreadyPatched ? current.pkg.__codexWorkflow.source : current.fingerprint;
if (!source?.asarSha256 || !source?.headerSha256 || !source?.version || !source?.build) {
  throw new Error("Patched app is missing a verified source fingerprint; restore it before reapplying");
}

if (alreadyPatched) resolveSourceBackup(source);
else if (!dryRun) ensureSourceBackup(source);

const warnings = [
  ...current.signatureIsValid ? [] : ["pre-existing-app-signature-invalid"],
];
if (dryRun) {
  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    reapply,
    recoveredPreviousTransaction: false,
    appVersion: current.pkg.version,
    alreadyPatched,
    source,
    currentIntegrity: current.expectedIntegrity,
    warnings,
  }, null, 2));
  process.exit(0);
}

const work = mkdtempSync(join(tmpdir(), "codex-workflow-install-"));
const patchedAsar = join(work, "app.asar");
const patchedPlist = join(work, "Info.plist");
let transaction;

try {
  await buildPatchedAsar(asarPath, patchedAsar, source);
  const patchedIntegrity = headerHash(patchedAsar);
  const patchedPackage = readPackage(patchedAsar);
  if (patchedPackage.main !== "workflow-loader.cjs" || patchedPackage.__codexWorkflow?.source?.asarSha256 !== source.asarSha256) {
    throw new Error("Patched package metadata failed verification");
  }

  cpSync(infoPlistPath, patchedPlist);
  setPlistValue("ElectronAsarIntegrity:Resources/app.asar:hash", patchedIntegrity, patchedPlist);

  transaction = createTransaction();
  installRuntimeFiles();
  transaction = setTransactionPhase(transaction, "runtime-installed");
  atomicReplace(patchedAsar, asarPath);
  transaction = setTransactionPhase(transaction, "asar-replaced");
  atomicReplace(patchedPlist, infoPlistPath);
  transaction = setTransactionPhase(transaction, "plist-replaced");

  const installed = preflightLiveUncached({ allowVersion });
  if (installed.pkg.main !== "workflow-loader.cjs" || installed.pkg.__codexWorkflow?.source?.asarSha256 !== source.asarSha256) {
    throw new Error("Installed package metadata failed verification");
  }
  const patchState = {
    schemaVersion: 2,
    patchVersion: installed.pkg.__codexWorkflow.version,
    loaderVersion: installed.pkg.__codexWorkflow.version,
    runtimeVersion: installed.pkg.__codexWorkflow.version,
    installedAt: new Date().toISOString(),
    source,
    installed: installed.fingerprint,
  };
  completeTransaction(transaction);
  transaction = undefined;
  try {
    writePatchState(patchState);
  } catch {
    warnings.push("state-write-failed");
  }
  try {
    installUpdaterAgent();
  } catch {
    warnings.push("background-updater-install-failed");
  }

  console.log(JSON.stringify({
    ok: true,
    reapply,
    recoveredPreviousTransaction: false,
    appVersion: installed.pkg.version,
    patchVersion: installed.pkg.__codexWorkflow.version,
    runtimeRoot,
    source,
    appAsarSize: prettyBytes(appAsarSize()),
    integrity: installed.expectedIntegrity,
    warnings,
    restartRequired: true,
  }, null, 2));
} catch (error) {
  if (transaction) {
    try {
      recoverPendingTransaction();
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], "Workflow patch failed and automatic recovery failed");
    }
  }
  throw error;
} finally {
  rmSync(work, { recursive: true, force: true });
}
