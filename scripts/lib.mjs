import * as asar from "@electron/asar";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const appRoot = "/Applications/ChatGPT.app";
export const asarPath = join(appRoot, "Contents", "Resources", "app.asar");
export const infoPlistPath = join(appRoot, "Contents", "Info.plist");
export const runtimeRoot = join(homedir(), "Library", "Application Support", "Codex Workflow");
export const disabledPath = join(runtimeRoot, "DISABLED");
export const updaterAgentPath = join(homedir(), "Library", "LaunchAgents", "com.ellisjpeg.codex-workflow-updater.plist");
export const compatibilityManifestPath = join(sourceRoot, "workflow-compatibility.json");
export const compatibilityManifest = readCompatibilityManifest(compatibilityManifestPath);
export const supportedVersion = compatibilityManifest.codexVersion;
export const supportedBuild = compatibilityManifest.codexBuild;
export const expectedBundleIdentifier = compatibilityManifest.bundleIdentifier;
export const expectedPackageName = compatibilityManifest.packageName;
export const patchVersion = compatibilityManifest.workflowVersion;
export const adhocEntitlementsPath = join(sourceRoot, "scripts", "adhoc.entitlements");
export const appleSignatureBackupName = "AppleSignature";

const journalPath = join(runtimeRoot, "transaction.json");
const backupsRoot = join(runtimeRoot, "backups");
const statePath = join(runtimeRoot, "state.json");
const managedRuntimePaths = [
  "runtime/main.cjs",
  "runtime/preload.cjs",
  "runtime/updater.cjs",
  "runtime/version.json",
  "update-config.json",
];

export function readCompatibilityManifest(targetPath) {
  const value = JSON.parse(readFileSync(targetPath, "utf8"));
  if (
    value?.schemaVersion !== 1 ||
    !/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(String(value.workflowVersion || "")) ||
    !/^[a-z0-9][a-z0-9._+-]{0,127}$/iu.test(String(value.codexVersion || "")) ||
    !/^[a-z0-9][a-z0-9._+-]{0,127}$/iu.test(String(value.codexBuild || "")) ||
    !/^[a-z0-9][a-z0-9.-]{1,127}$/iu.test(String(value.bundleIdentifier || "")) ||
    !/^[a-z0-9][a-z0-9._-]{1,127}$/iu.test(String(value.packageName || ""))
  ) {
    throw new Error("Workflow compatibility manifest is invalid");
  }
  return value;
}

export function readPackage(targetAsar = asarPath) {
  return JSON.parse(asar.extractFile(targetAsar, "package.json").toString("utf8"));
}

export function headerHash(targetAsar = asarPath) {
  const raw = asar.getRawHeader(targetAsar);
  return createHash("sha256").update(raw.headerString).digest("hex");
}

export function fileHash(targetPath) {
  const hash = createHash("sha256");
  const descriptor = openSync(targetPath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let offset = 0;
    for (;;) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, offset);
      if (bytes === 0) break;
      hash.update(buffer.subarray(0, bytes));
      offset += bytes;
    }
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

export function embeddedFileHash(internalPath, targetAsar = asarPath) {
  return createHash("sha256").update(asar.extractFile(targetAsar, internalPath)).digest("hex");
}

export function readRuntimeVersion(targetRoot = runtimeRoot) {
  const value = readJson(join(targetRoot, "runtime", "version.json"))?.version;
  return /^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(String(value || "")) ? value : null;
}

export function plistValue(keyPath, targetPlist = infoPlistPath) {
  return execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${keyPath}`, targetPlist], {
    encoding: "utf8",
  }).trim();
}

export function setPlistValue(keyPath, value, targetPlist = infoPlistPath) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${keyPath} ${value}`, targetPlist]);
}

export function signatureIsValid(targetApp = appRoot) {
  return spawnSync("codesign", ["--verify", "--deep", "--strict", targetApp], {
    stdio: "ignore",
  }).status === 0;
}

export function resignPatchedAppArgs(targetApp = appRoot) {
  return [
    "--force",
    "--deep",
    "--sign",
    "-",
    "--options",
    "runtime",
    "--entitlements",
    adhocEntitlementsPath,
    targetApp,
  ];
}

export function stashOpenAIProvisionProfile(targetApp = appRoot) {
  const profile = join(targetApp, "Contents", "embedded.provisionprofile");
  const stashed = join(targetApp, "Contents", "embedded.provisionprofile.openai");
  if (existsSync(profile)) renameSync(profile, stashed);
}

export function backupAppleSignature(backupDir, targetApp = appRoot) {
  const dest = join(backupDir, appleSignatureBackupName);
  if (existsSync(join(dest, "_CodeSignature", "CodeResources"))) return dest;
  mkdirSync(dest, { recursive: true });
  const srcSig = join(targetApp, "Contents", "_CodeSignature");
  if (existsSync(join(srcSig, "CodeResources"))) {
    cpSync(srcSig, join(dest, "_CodeSignature"), { recursive: true });
  }
  for (const name of ["embedded.provisionprofile", "embedded.provisionprofile.openai"]) {
    const src = join(targetApp, "Contents", name);
    if (existsSync(src) && !existsSync(join(dest, "embedded.provisionprofile"))) {
      copyFileDurably(src, join(dest, "embedded.provisionprofile"));
    }
  }
  const contentsCodeResources = join(targetApp, "Contents", "CodeResources");
  if (existsSync(contentsCodeResources)) {
    copyFileDurably(contentsCodeResources, join(dest, "Contents-CodeResources"));
  }
  return dest;
}

export function restoreAppleSignature(backupDir, targetApp = appRoot) {
  const signatureBackup = join(backupDir, appleSignatureBackupName);
  const srcSig = join(signatureBackup, "_CodeSignature");
  if (!existsSync(join(srcSig, "CodeResources"))) return false;
  const destSig = join(targetApp, "Contents", "_CodeSignature");
  rmSync(destSig, { recursive: true, force: true });
  cpSync(srcSig, destSig, { recursive: true });
  const srcContentsCodeResources = join(signatureBackup, "Contents-CodeResources");
  if (existsSync(srcContentsCodeResources)) {
    copyFileDurably(srcContentsCodeResources, join(targetApp, "Contents", "CodeResources"));
  }
  const srcProfile = join(signatureBackup, "embedded.provisionprofile");
  if (existsSync(srcProfile)) {
    copyFileDurably(srcProfile, join(targetApp, "Contents", "embedded.provisionprofile"));
  }
  const stashed = join(targetApp, "Contents", "embedded.provisionprofile.openai");
  if (existsSync(stashed)) rmSync(stashed, { force: true });
  return true;
}

export function resignPatchedApp(targetApp = appRoot) {
  if (!existsSync(adhocEntitlementsPath)) {
    throw new Error("Workflow ad-hoc entitlements file is missing");
  }
  stashOpenAIProvisionProfile(targetApp);
  const result = spawnSync("codesign", resignPatchedAppArgs(targetApp), { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "codesign failed").trim() || "codesign failed");
  }
  if (!signatureIsValid(targetApp)) {
    throw new Error("Ad-hoc re-sign did not produce a valid application signature");
  }
}

export function appIsRunning() {
  const executable = join(
    appRoot,
    "Contents",
    "MacOS",
    plistValue("CFBundleExecutable", infoPlistPath),
  );
  const processList = spawnSync("/bin/ps", ["-axo", "args="], { encoding: "utf8" });
  if (processList.status !== 0) {
    throw new Error("Could not verify whether ChatGPT/Codex is running");
  }
  return processList.stdout.split("\n")
    .some((line) => line === executable || line.startsWith(`${executable} `));
}

export function assertAppNotRunning() {
  if (appIsRunning()) {
    throw new Error("Quit ChatGPT/Codex before changing its application bundle");
  }
}

export function timestamp() {
  const now = new Date();
  const part = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}${part(now.getMonth() + 1)}${part(now.getDate())}-${part(now.getHours())}${part(now.getMinutes())}${part(now.getSeconds())}`;
}

export function fingerprint(targetAsar = asarPath, pkg = readPackage(targetAsar)) {
  return {
    version: pkg.version,
    build: String(pkg.codexBuildNumber || "unknown"),
    asarSha256: fileHash(targetAsar),
    headerSha256: headerHash(targetAsar),
  };
}

export function formatFingerprint(value) {
  const fingerprintValue = validateSourceFingerprint(value);
  return `${fingerprintValue.version}-${fingerprintValue.build}-${fingerprintValue.asarSha256.slice(0, 16)}`;
}

export function validateSourceFingerprint(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Workflow source fingerprint is missing");
  }
  for (const field of ["version", "build"]) {
    if (typeof value[field] !== "string" || !/^[a-z0-9][a-z0-9._+-]{0,127}$/iu.test(value[field])) {
      throw new Error(`Workflow source fingerprint has an invalid ${field}`);
    }
  }
  for (const field of ["asarSha256", "headerSha256"]) {
    if (typeof value[field] !== "string" || !/^[0-9a-f]{64}$/iu.test(value[field])) {
      throw new Error(`Workflow source fingerprint has an invalid ${field}`);
    }
  }
  return value;
}

export function preflight(targetAsar = asarPath, targetPlist = infoPlistPath, { allowVersion = false } = {}) {
  if (!existsSync(targetAsar) || !existsSync(targetPlist)) {
    throw new Error("ChatGPT app bundle is incomplete");
  }
  const bundleIdentifier = plistValue("CFBundleIdentifier", targetPlist);
  if (bundleIdentifier !== expectedBundleIdentifier) {
    throw new Error(`Unexpected bundle identifier ${bundleIdentifier}`);
  }
  const algorithm = plistValue("ElectronAsarIntegrity:Resources/app.asar:algorithm", targetPlist);
  if (algorithm !== "SHA256") {
    throw new Error(`Unexpected Electron ASAR integrity algorithm ${algorithm}`);
  }
  const expectedIntegrity = plistValue("ElectronAsarIntegrity:Resources/app.asar:hash", targetPlist);
  const computedIntegrity = headerHash(targetAsar);
  if (expectedIntegrity !== computedIntegrity) {
    throw new Error("Electron ASAR integrity metadata does not match app.asar");
  }
  const pkg = readPackage(targetAsar);
  if (pkg.name !== expectedPackageName) {
    throw new Error(`Unexpected package name ${pkg.name}`);
  }
  const bundleVersion = plistValue("CFBundleShortVersionString", targetPlist);
  const bundleBuild = plistValue("CFBundleVersion", targetPlist);
  const packageBuild = String(pkg.codexBuildNumber || "unknown");
  if (pkg.version !== bundleVersion) {
    throw new Error(`Codex package version ${pkg.version} does not match bundle version ${bundleVersion}`);
  }
  if (packageBuild !== bundleBuild) {
    throw new Error(`Codex package build ${packageBuild} does not match bundle build ${bundleBuild}`);
  }
  if (pkg.__codexWorkflow?.source) validateSourceFingerprint(pkg.__codexWorkflow.source);
  const originalMain = pkg.__codexWorkflow?.originalMain || pkg.main;
  if (typeof originalMain !== "string" || !originalMain.startsWith(".") || originalMain.includes("..")) {
    throw new Error("App main entry point is not a safe archive-relative path");
  }
  try {
    asar.extractFile(targetAsar, originalMain);
  } catch {
    throw new Error(`App main entry point is missing: ${originalMain}`);
  }
  if (pkg.version !== supportedVersion && !allowVersion) {
    throw new Error(`Unsupported Codex version ${pkg.version}; expected ${supportedVersion}`);
  }
  if (packageBuild !== supportedBuild && !allowVersion) {
    throw new Error(`Unsupported Codex build ${packageBuild}; expected ${supportedBuild}`);
  }
  return {
    pkg,
    bundleIdentifier,
    expectedIntegrity,
    computedIntegrity,
    originalMain,
    bundleVersion,
    bundleBuild,
    signatureIsValid: signatureIsValid(),
    fingerprint: fingerprint(targetAsar, pkg),
  };
}

export function preflightLiveUncached({ allowVersion = false } = {}) {
  const work = mkdtempSync(join(tmpdir(), "codex-workflow-verify-"));
  const snapshotAsar = join(work, "app.asar");
  const snapshotPlist = join(work, "Info.plist");
  try {
    cpSync(asarPath, snapshotAsar);
    cpSync(infoPlistPath, snapshotPlist);
    return preflight(snapshotAsar, snapshotPlist, { allowVersion });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export async function buildPatchedAsar(inputAsar, outputAsar, sourceFingerprint, targetRuntimeRoot = runtimeRoot) {
  const work = mkdtempSync(join(tmpdir(), "codex-workflow-asar-"));
  const extracted = join(work, "src");
  try {
    const unpackOptions = collectUnpackOptions(inputAsar);
    asar.extractAll(inputAsar, extracted);
    const packagePath = join(extracted, "package.json");
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    const originalMain = pkg.__codexWorkflow?.originalMain || pkg.main;
    pkg.main = "workflow-loader.cjs";
    pkg.__codexWorkflow = {
      version: patchVersion,
      appVersion: pkg.version,
      originalMain,
      runtimeRoot: targetRuntimeRoot,
      source: sourceFingerprint,
    };
    writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
    cpSync(join(sourceRoot, "loader.cjs"), join(extracted, "workflow-loader.cjs"));
    await asar.createPackageWithOptions(extracted, outputAsar, {
      globOptions: { dot: true },
      ...unpackOptions,
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function installRuntimeFiles({ autoRepairCodexUpdates } = {}) {
  const runtimeDestination = join(runtimeRoot, "runtime");
  mkdirSync(runtimeDestination, { recursive: true });
  atomicReplace(join(sourceRoot, "runtime", "main.cjs"), join(runtimeDestination, "main.cjs"));
  atomicReplace(join(sourceRoot, "runtime", "preload.cjs"), join(runtimeDestination, "preload.cjs"));
  atomicReplace(join(sourceRoot, "runtime", "updater.cjs"), join(runtimeDestination, "updater.cjs"));
  writeJsonAtomic(join(runtimeDestination, "version.json"), {
    schemaVersion: 1,
    version: patchVersion,
  });
  const previousUpdateConfig = readJson(join(runtimeRoot, "update-config.json"));
  const automaticRepair = typeof autoRepairCodexUpdates === "boolean"
    ? autoRepairCodexUpdates
    : previousUpdateConfig?.autoRepairCodexUpdates === true;
  writeJsonAtomic(join(runtimeRoot, "update-config.json"), {
    schemaVersion: 1,
    sourceRoot,
    nodeExecutable: process.execPath,
    appRoot,
    appExecutable: join(
      appRoot,
      "Contents",
      "MacOS",
      plistValue("CFBundleExecutable", infoPlistPath),
    ),
    releaseApi: "https://api.github.com/repos/ellisjpeg/codex-workflow/releases/latest",
    codexVersion: supportedVersion,
    codexBuild: supportedBuild,
    bundleIdentifier: expectedBundleIdentifier,
    packageName: expectedPackageName,
    autoRepairCodexUpdates: automaticRepair,
  });
  const settingsPath = join(runtimeRoot, "settings.json");
  if (!existsSync(settingsPath)) {
    writeJsonAtomic(settingsPath, {
      schemaVersion: 2,
      focusedInterface: true,
      hidePullRequests: true,
      hidePetMenuItem: true,
      hideInviteFriendMenuItem: true,
      replaceHelpWithSettings: true,
      hideComposerMicrophone: false,
    });
  }
}

export function installUpdaterAgent() {
  const executable = process.execPath;
  const escapeXml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ellisjpeg.codex-workflow-updater</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(executable)}</string>
    <string>${escapeXml(join(runtimeRoot, "runtime", "updater.cjs"))}</string>
    <string>--background</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_WORKFLOW_ROOT</key><string>${escapeXml(runtimeRoot)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${escapeXml(join(runtimeRoot, "logs", "updater.log"))}</string>
  <key>StandardErrorPath</key><string>${escapeXml(join(runtimeRoot, "logs", "updater.log"))}</string>
</dict>
</plist>
`;
  mkdirSync(dirname(updaterAgentPath), { recursive: true });
  const stageDir = mkdtempSync(join(dirname(updaterAgentPath), ".codex-workflow-"));
  try {
    const staged = join(stageDir, "updater.plist");
    writeFileSync(staged, plist, { mode: 0o600 });
    renameSync(staged, updaterAgentPath);
    fsyncDirectory(dirname(updaterAgentPath));
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
  const domain = `gui/${process.getuid()}`;
  spawnSync("/bin/launchctl", ["bootout", domain, updaterAgentPath], { stdio: "ignore" });
  const loaded = spawnSync("/bin/launchctl", ["bootstrap", domain, updaterAgentPath], {
    encoding: "utf8",
  });
  if (loaded.status !== 0) {
    throw new Error((loaded.stderr || "Workflow background updater could not be loaded").trim());
  }
}

export function uninstallUpdaterAgent() {
  const domain = `gui/${process.getuid()}`;
  spawnSync("/bin/launchctl", ["bootout", domain, updaterAgentPath], { stdio: "ignore" });
  if (existsSync(updaterAgentPath)) {
    rmSync(updaterAgentPath, { force: true });
    fsyncDirectory(dirname(updaterAgentPath));
  }
}

export function ensureSourceBackup(source) {
  const backupDir = sourceBackupDirectory(source);
  const backupAsar = join(backupDir, "app.asar");
  const backupPlist = join(backupDir, "Info.plist");
  const manifestPath = join(backupDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = readJson(manifestPath);
    if (!manifest || manifest.source?.asarSha256 !== source.asarSha256 || !existsSync(backupAsar) || !existsSync(backupPlist)) {
      throw new Error(`Source backup is incomplete or does not match ${formatFingerprint(source)}`);
    }
    backupAppleSignature(backupDir);
    return resolveSourceBackup(source);
  }
  assertNoSymlink(backupsRoot, "backup root");
  assertNoSymlink(backupDir, "source backup");
  mkdirSync(backupDir, { recursive: true });
  assertManagedDirectory(backupsRoot, backupDir, "source backup");
  copyFileDurably(asarPath, backupAsar);
  copyFileDurably(infoPlistPath, backupPlist);
  backupAppleSignature(backupDir);
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    bundleIdentifier: plistValue("CFBundleIdentifier"),
    source,
  };
  writeJsonAtomic(manifestPath, manifest);
  return resolveSourceBackup(source);
}

export function resolveSourceBackup(source) {
  const backupDir = sourceBackupDirectory(source);
  const backupAsar = join(backupDir, "app.asar");
  const backupPlist = join(backupDir, "Info.plist");
  const manifestPath = join(backupDir, "manifest.json");
  assertNoSymlink(backupsRoot, "backup root");
  assertManagedDirectory(backupsRoot, backupDir, "source backup");
  for (const target of [backupAsar, backupPlist, manifestPath]) {
    assertManagedFile(backupDir, target, "source backup file");
  }
  const manifest = readJson(manifestPath);
  if (!manifest || manifest.source?.asarSha256 !== source.asarSha256 || !existsSync(backupAsar) || !existsSync(backupPlist)) {
    throw new Error(`No verified source backup for ${formatFingerprint(source)}`);
  }
  validateSourceFingerprint(manifest.source);
  const backupCheck = preflight(backupAsar, backupPlist, { allowVersion: true });
  if (backupCheck.fingerprint.asarSha256 !== source.asarSha256) {
    throw new Error("Source backup ASAR hash does not match its manifest");
  }
  return { backupDir, backupAsar, backupPlist, manifestPath, manifest };
}

function snapshotBundleSignature(transactionDir, targetApp = appRoot) {
  const dest = join(transactionDir, "rollback-AppleSignature");
  const srcSig = join(targetApp, "Contents", "_CodeSignature");
  const hadBundleSignature = existsSync(join(srcSig, "CodeResources"));
  mkdirSync(dest, { recursive: true });
  if (hadBundleSignature) {
    cpSync(srcSig, join(dest, "_CodeSignature"), { recursive: true });
  }
  for (const name of ["embedded.provisionprofile", "embedded.provisionprofile.openai"]) {
    const src = join(targetApp, "Contents", name);
    if (existsSync(src)) copyFileDurably(src, join(dest, name));
  }
  const contentsCodeResources = join(targetApp, "Contents", "CodeResources");
  if (existsSync(contentsCodeResources)) {
    copyFileDurably(contentsCodeResources, join(dest, "Contents-CodeResources"));
  }
  return { rollbackAppleSignature: dest, hadBundleSignature };
}

function restoreBundleSignatureSnapshot(snapshotDir, hadBundleSignature, targetApp = appRoot) {
  const srcSig = join(snapshotDir, "_CodeSignature");
  if (hadBundleSignature && !existsSync(join(srcSig, "CodeResources"))) {
    throw new Error("Workflow patch signature rollback snapshot is incomplete");
  }
  const contents = join(targetApp, "Contents");
  const destSig = join(contents, "_CodeSignature");
  rmSync(destSig, { recursive: true, force: true });
  if (hadBundleSignature) cpSync(srcSig, destSig, { recursive: true });
  rmSync(join(contents, "CodeResources"), { force: true });
  const srcContentsCodeResources = join(snapshotDir, "Contents-CodeResources");
  if (existsSync(srcContentsCodeResources)) {
    copyFileDurably(srcContentsCodeResources, join(contents, "CodeResources"));
  }
  for (const name of ["embedded.provisionprofile", "embedded.provisionprofile.openai"]) {
    rmSync(join(contents, name), { force: true });
    const src = join(snapshotDir, name);
    if (existsSync(src)) copyFileDurably(src, join(contents, name));
  }
  return true;
}

export function createTransaction() {
  mkdirSync(runtimeRoot, { recursive: true });
  if (existsSync(journalPath)) {
    throw new Error("An incomplete Workflow patch transaction exists; run recovery first");
  }
  const id = `${timestamp()}-${randomUUID()}`;
  const transactionDir = join(runtimeRoot, "transactions", id);
  mkdirSync(transactionDir, { recursive: true });
  const rollbackAsar = join(transactionDir, "rollback.asar");
  const rollbackPlist = join(transactionDir, "rollback.Info.plist");
  try {
    copyFileDurably(asarPath, rollbackAsar);
    copyFileDurably(infoPlistPath, rollbackPlist);
    const signatureSnapshot = snapshotBundleSignature(transactionDir);
    const runtimeFiles = managedRuntimePaths.map((relativePath) => {
      const target = join(runtimeRoot, relativePath);
      const rollback = join(transactionDir, "rollback-runtime", relativePath);
      const existed = existsSync(target);
      if (existed) copyFileDurably(target, rollback);
      return { relativePath, existed };
    });
    const journal = {
      schemaVersion: 1,
      id,
      createdAt: new Date().toISOString(),
      phase: "prepared",
      transactionDir,
      rollbackAsar,
      rollbackPlist,
      runtimeFiles,
      ...signatureSnapshot,
    };
    writeJsonAtomic(journalPath, journal);
    return journal;
  } catch (error) {
    rmSync(transactionDir, { recursive: true, force: true });
    throw error;
  }
}

export function setTransactionPhase(journal, phase) {
  const next = { ...journal, phase, updatedAt: new Date().toISOString() };
  writeJsonAtomic(journalPath, next);
  return next;
}

export function completeTransaction(journal) {
  rmSync(journalPath, { force: true });
  fsyncDirectory(dirname(journalPath));
  try {
    rmSync(journal.transactionDir, { recursive: true, force: true });
  } catch {}
}

export function pendingTransaction() {
  if (!existsSync(journalPath)) return null;
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, "utf8"));
  } catch {
    throw new Error("Workflow patch transaction journal is unreadable; inspect it before continuing");
  }
  return validateTransactionJournal(journal);
}

export function transactionRecoveryStatus(journal) {
  if (!journal) return { ready: false, reason: "missing-journal" };
  if (!Array.isArray(journal.runtimeFiles)) {
    return { ready: false, reason: "legacy-journal-missing-runtime-metadata" };
  }
  const missing = [journal.rollbackAsar, journal.rollbackPlist]
    .filter((target) => !existsSync(target));
  if (journal.rollbackAppleSignature !== undefined) {
    if (!existsSync(journal.rollbackAppleSignature)) missing.push(journal.rollbackAppleSignature);
    if (journal.hadBundleSignature
      && !existsSync(join(journal.rollbackAppleSignature, "_CodeSignature", "CodeResources"))) {
      missing.push(join(journal.rollbackAppleSignature, "_CodeSignature", "CodeResources"));
    }
  }
  for (const entry of journal.runtimeFiles || []) {
    if (!entry.existed) continue;
    const rollback = join(journal.transactionDir, "rollback-runtime", entry.relativePath);
    if (!existsSync(rollback)) missing.push(rollback);
  }
  return missing.length
    ? { ready: false, reason: "missing-rollback-files", missingCount: missing.length }
    : { ready: true };
}

export function recoverPendingTransaction() {
  const journal = pendingTransaction();
  if (!journal) return { recovered: false };
  return recoverTransaction(journal);
}

export function recoverTransaction(journal, {
  targetAsar = asarPath,
  targetPlist = infoPlistPath,
  targetRuntimeRoot = runtimeRoot,
  targetApp = targetAsar === asarPath ? appRoot : null,
  verifyRollback = () => preflight(journal.rollbackAsar, journal.rollbackPlist, { allowVersion: true }),
  verifyRestored = () => {
    if (targetAsar === asarPath && targetPlist === infoPlistPath) {
      return preflightLiveUncached({ allowVersion: true });
    }
    return preflight(targetAsar, targetPlist, { allowVersion: true });
  },
  finish = completeTransaction,
} = {}) {
  const recovery = transactionRecoveryStatus(journal);
  if (!recovery.ready) {
    throw new Error("Workflow patch recovery files are missing; do not modify the app bundle");
  }
  verifyRollback();
  restoreFilePair(journal.rollbackAsar, journal.rollbackPlist, targetAsar, targetPlist);
  restoreRuntimeFiles(journal, targetRuntimeRoot);
  if (journal.rollbackAppleSignature !== undefined && targetApp !== null) {
    restoreBundleSignatureSnapshot(journal.rollbackAppleSignature, journal.hadBundleSignature, targetApp);
  }
  verifyRestored();
  finish(journal);
  return { recovered: true, id: journal.id, phase: journal.phase };
}

export function restoreFilePair(
  backupAsar,
  backupPlist,
  targetAsar = asarPath,
  targetPlist = infoPlistPath,
) {
  atomicReplace(backupAsar, targetAsar);
  atomicReplace(backupPlist, targetPlist);
}

export function restoreRuntimeFiles(journal, targetRoot = runtimeRoot) {
  for (const entry of journal.runtimeFiles || []) {
    if (!managedRuntimePaths.includes(entry.relativePath) || typeof entry.existed !== "boolean") {
      throw new Error("Workflow runtime rollback metadata is invalid");
    }
    const target = join(targetRoot, entry.relativePath);
    if (entry.existed) {
      atomicReplace(join(journal.transactionDir, "rollback-runtime", entry.relativePath), target);
    } else if (existsSync(target)) {
      rmSync(target, { force: true });
      fsyncDirectory(dirname(target));
    }
  }
}

export function atomicReplace(from, to) {
  const stageDir = mkdtempSync(join(dirname(to), ".codex-workflow-"));
  const staged = join(stageDir, "replacement");
  try {
    copyFileDurably(from, staged);
    renameSync(staged, to);
    if (to.endsWith(".asar")) asar.uncache(to);
    fsyncDirectory(dirname(to));
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

export function writeJsonAtomic(targetPath, value) {
  mkdirSync(dirname(targetPath), { recursive: true });
  const stageDir = mkdtempSync(join(dirname(targetPath), ".codex-workflow-"));
  const staged = join(stageDir, "replacement.json");
  try {
    writeFileSync(staged, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fsyncFile(staged);
    renameSync(staged, targetPath);
    fsyncDirectory(dirname(targetPath));
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}

export function writePatchState(value) {
  writeJsonAtomic(statePath, value);
}

export function readPatchState() {
  return readJson(statePath);
}

export function readSettings() {
  return readJson(join(runtimeRoot, "settings.json"));
}

function sourceBackupDirectory(source) {
  const target = resolve(backupsRoot, formatFingerprint(source));
  const child = relative(resolve(backupsRoot), target);
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error("Workflow source backup path escapes the managed backup root");
  }
  return target;
}

function assertNoSymlink(targetPath, label) {
  if (existsSync(targetPath) && lstatSync(targetPath).isSymbolicLink()) {
    throw new Error(`Workflow ${label} must not be a symbolic link`);
  }
}

function assertManagedDirectory(rootPath, targetPath, label) {
  if (!existsSync(targetPath)) return;
  assertNoSymlinkComponents(rootPath, targetPath, label);
  const child = relative(realpathSync(rootPath), realpathSync(targetPath));
  if (child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error(`Workflow ${label} escapes its managed root`);
  }
}

function assertManagedFile(rootPath, targetPath, label) {
  if (!existsSync(targetPath)) return;
  assertNoSymlinkComponents(rootPath, targetPath, label);
  const child = relative(realpathSync(rootPath), realpathSync(targetPath));
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error(`Workflow ${label} escapes its managed root`);
  }
}

function assertNoSymlinkComponents(rootPath, targetPath, label) {
  const root = resolve(rootPath);
  const target = resolve(targetPath);
  const child = relative(root, target);
  if (child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error(`Workflow ${label} escapes its managed root`);
  }
  let current = root;
  assertNoSymlink(current, `${label} root`);
  for (const part of child.split("/").filter(Boolean)) {
    current = join(current, part);
    assertNoSymlink(current, label);
  }
}

export function prettyBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function appAsarSize() {
  return statSync(asarPath).size;
}

function readJson(targetPath) {
  try {
    return JSON.parse(readFileSync(targetPath, "utf8"));
  } catch {
    return null;
  }
}

export function validateTransactionJournal(journal) {
  if (
    !journal ||
    journal.schemaVersion !== 1 ||
    typeof journal.id !== "string" ||
    typeof journal.phase !== "string" ||
    typeof journal.transactionDir !== "string" ||
    typeof journal.rollbackAsar !== "string" ||
    typeof journal.rollbackPlist !== "string"
  ) {
    throw new Error("Workflow patch transaction journal has an unsupported schema");
  }
  if (!/^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(journal.id)) {
    throw new Error("Workflow patch transaction journal has an invalid id");
  }
  if (!["prepared", "runtime-installed", "asar-replaced", "plist-replaced", "signed", "asar-restored", "plist-restored"].includes(journal.phase)) {
    throw new Error("Workflow patch transaction journal has an invalid phase");
  }
  const expectedDir = join(runtimeRoot, "transactions", journal.id);
  const expectedAsar = join(expectedDir, "rollback.asar");
  const expectedPlist = join(expectedDir, "rollback.Info.plist");
  const expectedSignature = join(expectedDir, "rollback-AppleSignature");
  const hasSignaturePath = Object.hasOwn(journal, "rollbackAppleSignature");
  const hasSignatureFlag = Object.hasOwn(journal, "hadBundleSignature");
  if (hasSignaturePath !== hasSignatureFlag
    || (hasSignaturePath && (typeof journal.rollbackAppleSignature !== "string"
      || typeof journal.hadBundleSignature !== "boolean"))) {
    throw new Error("Workflow patch transaction journal has invalid signature rollback metadata");
  }
  if (
    resolve(journal.transactionDir) !== resolve(expectedDir) ||
    resolve(journal.rollbackAsar) !== resolve(expectedAsar) ||
    resolve(journal.rollbackPlist) !== resolve(expectedPlist) ||
    (hasSignaturePath &&
      resolve(journal.rollbackAppleSignature) !== resolve(expectedSignature))
  ) {
    throw new Error("Workflow patch transaction journal contains unsafe paths");
  }
  const transactionsRoot = join(runtimeRoot, "transactions");
  assertNoSymlink(transactionsRoot, "transaction root");
  assertNoSymlink(journal.transactionDir, "transaction directory");
  if (existsSync(journal.transactionDir)) {
    assertManagedDirectory(transactionsRoot, journal.transactionDir, "transaction directory");
  }
  for (const target of [journal.rollbackAsar, journal.rollbackPlist]) {
    assertNoSymlink(target, "transaction rollback file");
    if (existsSync(target)) assertManagedFile(journal.transactionDir, target, "transaction rollback file");
  }
  if (hasSignaturePath) {
    assertNoSymlink(journal.rollbackAppleSignature, "signature rollback directory");
    if (existsSync(journal.rollbackAppleSignature)) {
      assertManagedDirectory(journal.transactionDir, journal.rollbackAppleSignature, "signature rollback directory");
    }
  }
  if (journal.runtimeFiles !== undefined) {
    if (!Array.isArray(journal.runtimeFiles)) {
      throw new Error("Workflow patch transaction journal has invalid runtime rollback metadata");
    }
    const seen = new Set();
    for (const entry of journal.runtimeFiles) {
      if (!entry || !managedRuntimePaths.includes(entry.relativePath) || typeof entry.existed !== "boolean") {
        throw new Error("Workflow patch transaction journal has invalid runtime rollback metadata");
      }
      if (seen.has(entry.relativePath)) {
        throw new Error("Workflow patch transaction journal repeats runtime rollback metadata");
      }
      seen.add(entry.relativePath);
      const rollback = join(journal.transactionDir, "rollback-runtime", entry.relativePath);
      assertNoSymlink(rollback, "runtime rollback file");
      if (existsSync(rollback)) {
        assertManagedFile(journal.transactionDir, rollback, "runtime rollback file");
      }
    }
    if (seen.size !== managedRuntimePaths.length) {
      throw new Error("Workflow patch transaction journal has incomplete runtime rollback metadata");
    }
  }
  return journal;
}

function copyFileDurably(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  fsyncFile(to);
  fsyncDirectory(dirname(to));
}

function fsyncFile(targetPath) {
  const descriptor = openSync(targetPath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function fsyncDirectory(targetPath) {
  const descriptor = openSync(targetPath, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function collectUnpackOptions(targetAsar) {
  const sibling = `${targetAsar}.unpacked`;
  if (!existsSync(sibling)) return {};
  const raw = asar.getRawHeader(targetAsar);
  const covers = unpackCovers(raw.header, "").covers;
  const dirs = covers.filter((cover) => cover.type === "dir").map((cover) => stripSlash(cover.path));
  const files = covers.filter((cover) => cover.type === "file").map((cover) => `**/${stripSlash(cover.path)}`);
  return {
    ...(files.length ? { unpack: bracePattern(files) } : {}),
    ...(dirs.length ? { unpackDir: bracePattern(dirs) } : {}),
  };
}

function unpackCovers(node, prefix) {
  const files = node?.files;
  if (!files) return { total: 0, unpacked: 0, covers: [] };
  let total = 0;
  let unpacked = 0;
  const covers = [];
  for (const [name, value] of Object.entries(files)) {
    const current = `${prefix}/${name}`;
    if (value?.files) {
      const child = unpackCovers(value, current);
      total += child.total;
      unpacked += child.unpacked;
      covers.push(...child.covers);
    } else {
      total += 1;
      if (value?.unpacked) {
        unpacked += 1;
        covers.push({ type: "file", path: current });
      }
    }
  }
  if (prefix && total > 0 && total === unpacked) {
    return { total, unpacked, covers: [{ type: "dir", path: prefix }] };
  }
  return { total, unpacked, covers };
}

function stripSlash(value) {
  return value.replace(/^\/+/, "");
}

function bracePattern(values) {
  return values.length === 1 ? values[0] : `{${values.join(",")}}`;
}
