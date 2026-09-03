import {
  closeSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import {
  appRoot,
  asarPath,
  atomicReplace,
  buildPatchedAsar,
  embeddedFileHash,
  expectedPackageName,
  fileHash,
  fingerprint,
  headerHash,
  infoPlistPath,
  patchVersion,
  plistValue,
  preflight,
  readPackage,
  resignPatchedApp,
  setPlistValue,
  signatureIsValid,
  sourceRoot,
  supportedBuild,
  supportedVersion,
  writeJsonAtomic,
} from "./lib.mjs";

export const stagingPrefix = "codex-workflow-staging-";
export const stagingBaseRoot = "/private/tmp";
export const stagingBundleIdentifier = "com.openai.codex.workflow-staging.v2690120858";
export const stagingName = "Codex Workflow Staging";
export const stagingExecutableName = "CodexWorkflowStaging-2690120858";
export const stagingUnixSocketPathMaxBytes = 103;

export function assertStagingRoot(targetRoot) {
  const root = resolve(targetRoot);
  const temporaryRoot = resolve(stagingBaseRoot);
  if (dirname(root) !== temporaryRoot || !basename(root).startsWith(stagingPrefix)) {
    throw new Error("Staging root must be a generated direct child of the system temporary directory");
  }
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) {
    throw new Error("Staging root must not be a symbolic link");
  }
  return root;
}

export function assertManagedStagingPath(targetRoot, targetPath, label = "managed path") {
  const root = assertStagingRoot(targetRoot);
  const target = resolve(targetPath);
  const child = relative(root, target);
  if (!child || child === ".." || child.startsWith("../") || isAbsolute(child)) {
    throw new Error(`Staging ${label} escapes its generated root`);
  }
  let current = root;
  for (const part of child.split("/").filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Staging ${label} must not contain symbolic links`);
    }
  }
  return target;
}

export function stagingLayout(targetRoot, devToolsPort) {
  const root = assertStagingRoot(targetRoot);
  if (!Number.isSafeInteger(devToolsPort) || devToolsPort < 1024 || devToolsPort > 65535) {
    throw new Error("Staging DevTools port must be an integer from 1024 through 65535");
  }
  const app = join(root, `${stagingName}.app`);
  const workflowRoot = join(root, "state", "workflow");
  const layout = {
    root,
    app,
    asar: join(app, "Contents", "Resources", "app.asar"),
    plist: join(app, "Contents", "Info.plist"),
    executable: join(app, "Contents", "MacOS", stagingExecutableName),
    userData: join(root, "state", "user-data"),
    codexHome: join(root, "state", "codex-home"),
    workflowRoot,
    settings: join(workflowRoot, "settings.json"),
    logs: join(workflowRoot, "logs"),
    journal: join(workflowRoot, "transaction.json"),
    updates: join(workflowRoot, "updates"),
    updateState: join(workflowRoot, "update-state.json"),
    backups: join(workflowRoot, "backups"),
    sourceBackup: join(workflowRoot, "backups", "source"),
    processLog: join(workflowRoot, "logs", "process.log"),
    manifest: join(root, "staging-manifest.json"),
    devToolsPort,
  };
  const ipcSocket = join(layout.codexHome, "ipc", "ipc.sock");
  if (Buffer.byteLength(ipcSocket) > stagingUnixSocketPathMaxBytes) {
    throw new Error("Staging CODEX_HOME IPC socket path exceeds the macOS Unix-socket limit");
  }
  return layout;
}

function run(command, args, message) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || message).trim() || message);
  }
  return result.stdout;
}

function setPlistString(key, value, targetPlist) {
  run("/usr/bin/plutil", ["-replace", key, "-string", value, targetPlist], `Could not set ${key}`);
}

function removePlistKey(key, targetPlist) {
  spawnSync("/usr/bin/plutil", ["-remove", key, targetPlist], { stdio: "ignore" });
}

function plistHasKey(key, targetPlist) {
  return spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, targetPlist], {
    stdio: "ignore",
  }).status === 0;
}

function assertPortAvailable(port) {
  const result = spawnSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
  });
  if (result.status === 0) throw new Error(`Staging DevTools port ${port} is already in use`);
  if (result.status !== 1) throw new Error("Could not inspect the staging DevTools port");
}

function installStagingRuntime(layout, source) {
  for (const target of [
    layout.userData,
    layout.codexHome,
    layout.logs,
    layout.updates,
    layout.backups,
    join(layout.workflowRoot, "transactions"),
    join(layout.workflowRoot, "runtime"),
  ]) {
    mkdirSync(target, { recursive: true, mode: 0o700 });
  }
  for (const name of ["main.cjs", "preload.cjs", "updater.cjs"]) {
    cpSync(join(sourceRoot, "runtime", name), join(layout.workflowRoot, "runtime", name));
  }
  writeJsonAtomic(join(layout.workflowRoot, "runtime", "version.json"), {
    schemaVersion: 1,
    version: patchVersion,
  });
  writeJsonAtomic(layout.settings, {
    schemaVersion: 2,
    focusedInterface: true,
    hidePullRequests: true,
    hidePetMenuItem: true,
    hideInviteFriendMenuItem: true,
    replaceHelpWithSettings: true,
  });
  writeJsonAtomic(join(layout.workflowRoot, "update-config.json"), {
    schemaVersion: 1,
    sourceRoot,
    nodeExecutable: process.execPath,
    appRoot: layout.app,
    appExecutable: layout.executable,
    releaseApi: null,
  });
  writeJsonAtomic(layout.updateState, {
    schemaVersion: 1,
    checkedAt: null,
    remoteCheckedAt: null,
    installedVersion: patchVersion,
    availableVersion: null,
    stagedSourceRoot: null,
    error: null,
  });
  writeJsonAtomic(join(layout.workflowRoot, "state.json"), {
    schemaVersion: 2,
    patchVersion,
    loaderVersion: patchVersion,
    runtimeVersion: patchVersion,
    installedAt: new Date().toISOString(),
    source,
  });
}

function verifyStagingApp(layout, source, { restored = false } = {}) {
  const pkg = readPackage(layout.asar);
  const integrity = headerHash(layout.asar);
  const runtimeFiles = ["main.cjs", "preload.cjs", "updater.cjs"].map((name) => ({
    name,
    matchesSource: fileHash(join(layout.workflowRoot, "runtime", name)) ===
      fileHash(join(sourceRoot, "runtime", name)),
  }));
  const checks = {
    version: pkg.version === supportedVersion,
    build: String(pkg.codexBuildNumber || "unknown") === supportedBuild,
    packageName: pkg.name === expectedPackageName,
    bundleIdentifier: plistValue("CFBundleIdentifier", layout.plist) === stagingBundleIdentifier,
    bundleName: plistValue("CFBundleName", layout.plist) === stagingName,
    displayName: plistValue("CFBundleDisplayName", layout.plist) === stagingName,
    executableName: plistValue("CFBundleExecutable", layout.plist) === stagingExecutableName,
    executablePresent: existsSync(layout.executable),
    urlHandlersAbsent: !plistHasKey("CFBundleURLTypes", layout.plist),
    documentHandlersAbsent: !plistHasKey("CFBundleDocumentTypes", layout.plist),
    integrity: plistValue("ElectronAsarIntegrity:Resources/app.asar:hash", layout.plist) === integrity,
    signature: signatureIsValid(layout.app),
    runtimeFiles: runtimeFiles.every((entry) => entry.matchesSource),
  };
  if (restored) {
    checks.originalMain = pkg.main === source.originalMain;
    checks.workflowMetadataAbsent = !pkg.__codexWorkflow;
    checks.sourceAsar = fileHash(layout.asar) === source.asarSha256;
  } else {
    checks.loaderMain = pkg.main === "workflow-loader.cjs";
    checks.runtimeRoot = pkg.__codexWorkflow?.runtimeRoot === layout.workflowRoot;
    checks.sourceFingerprint = pkg.__codexWorkflow?.source?.asarSha256 === source.asarSha256;
    checks.loaderCurrent = embeddedFileHash("workflow-loader.cjs", layout.asar) ===
      fileHash(join(sourceRoot, "loader.cjs"));
  }
  if (!Object.values(checks).every(Boolean)) {
    throw new Error(`Staging verification failed: ${JSON.stringify(checks)}`);
  }
  return { checks, integrity, package: pkg };
}

export async function prepareStaging(devToolsPort) {
  if (process.platform !== "darwin") throw new Error("Staging is supported only on macOS");
  assertPortAvailable(devToolsPort);
  const current = preflight();
  if (current.pkg.__codexWorkflow || current.pkg.main === "workflow-loader.cjs") {
    throw new Error("Staging must be prepared from the audited stock Codex bundle");
  }
  const root = mkdtempSync(join(stagingBaseRoot, stagingPrefix));
  const layout = stagingLayout(root, devToolsPort);
  try {
    run("/bin/cp", ["-cR", appRoot, layout.app], "Could not create the APFS staging clone");
    const originalExecutableName = plistValue("CFBundleExecutable", layout.plist);
    if (!originalExecutableName || originalExecutableName.includes("/")) {
      throw new Error("Stock Codex executable name is unsafe");
    }
    const originalExecutable = join(layout.app, "Contents", "MacOS", originalExecutableName);
    renameSync(originalExecutable, layout.executable);
    setPlistString("CFBundleIdentifier", stagingBundleIdentifier, layout.plist);
    setPlistString("CFBundleName", stagingName, layout.plist);
    setPlistString("CFBundleDisplayName", stagingName, layout.plist);
    setPlistString("CFBundleExecutable", stagingExecutableName, layout.plist);
    removePlistKey("CFBundleURLTypes", layout.plist);
    removePlistKey("CFBundleDocumentTypes", layout.plist);

    mkdirSync(layout.sourceBackup, { recursive: true, mode: 0o700 });
    cpSync(layout.asar, join(layout.sourceBackup, "app.asar"));
    cpSync(layout.plist, join(layout.sourceBackup, "Info.plist"));
    const source = {
      ...current.fingerprint,
      originalMain: current.originalMain,
    };
    writeJsonAtomic(join(layout.sourceBackup, "manifest.json"), {
      schemaVersion: 1,
      source,
      plistSha256: fileHash(join(layout.sourceBackup, "Info.plist")),
      stagingBundleIdentifier,
    });
    installStagingRuntime(layout, source);

    const buildRoot = join(root, ".build");
    mkdirSync(buildRoot, { mode: 0o700 });
    const patchedAsar = join(buildRoot, "app.asar");
    await buildPatchedAsar(asarPath, patchedAsar, current.fingerprint, layout.workflowRoot);
    atomicReplace(patchedAsar, layout.asar);
    setPlistValue(
      "ElectronAsarIntegrity:Resources/app.asar:hash",
      headerHash(layout.asar),
      layout.plist,
    );
    resignPatchedApp(layout.app);
    rmSync(buildRoot, { recursive: true, force: true });

    const verification = verifyStagingApp(layout, source);
    const installed = fingerprint(layout.asar, verification.package);
    const manifest = {
      schemaVersion: 1,
      status: "prepared",
      createdAt: new Date().toISOString(),
      ...layout,
      bundleIdentifier: stagingBundleIdentifier,
      bundleName: stagingName,
      executableName: stagingExecutableName,
      sourceApp: appRoot,
      source,
      installed,
      patchVersion,
      processId: null,
      launchedAt: null,
      updaterIsolation: {
        sparkleEnabled: false,
        workflowReleaseApi: null,
        launchAgentInstalled: false,
      },
      verification: verification.checks,
    };
    writeJsonAtomic(layout.manifest, manifest);
    return manifest;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function readManifest(manifestPath) {
  const parsed = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  if (parsed?.schemaVersion !== 1 || typeof parsed.root !== "string") {
    throw new Error("Staging manifest has an unsupported schema");
  }
  const layout = stagingLayout(parsed.root, parsed.devToolsPort);
  if (resolve(manifestPath) !== layout.manifest) {
    throw new Error("Staging manifest is outside its validated root");
  }
  for (const key of [
    "app", "asar", "plist", "executable", "userData", "codexHome", "workflowRoot",
    "settings", "logs", "journal", "updates", "updateState", "backups", "sourceBackup",
    "processLog", "manifest",
  ]) {
    if (parsed[key] !== layout[key]) throw new Error(`Staging manifest has an unsafe ${key} path`);
    assertManagedStagingPath(layout.root, layout[key], key);
  }
  if (
    parsed.bundleIdentifier !== stagingBundleIdentifier ||
    parsed.executableName !== stagingExecutableName ||
    parsed.sourceApp !== appRoot
  ) {
    throw new Error("Staging manifest identity is invalid");
  }
  return parsed;
}

function lsofRecords(args) {
  const result = spawnSync("/usr/sbin/lsof", ["-nP", "-Fpct", ...args], { encoding: "utf8" });
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error("Could not inspect staging processes");
  const records = [];
  let record = null;
  for (const line of result.stdout.split("\n")) {
    if (line.startsWith("p")) {
      record = { processId: Number(line.slice(1)), command: null };
      records.push(record);
    } else if (record && line.startsWith("c")) {
      record.command = line.slice(1);
    }
  }
  return records.filter((entry) => Number.isSafeInteger(entry.processId));
}

function assertExactProcess(processId, executable) {
  const matches = lsofRecords(["-a", "-d", "txt", "--", executable]);
  if (!matches.some((entry) => entry.processId === processId)) {
    throw new Error("Staging process identity does not match its manifest");
  }
  return executable;
}

function exactProcessIsRunning(processId, executable) {
  return lsofRecords(["-a", "-d", "txt", "--", executable])
    .some((entry) => entry.processId === processId);
}

function processesUnderRoot(root) {
  return lsofRecords(["+D", join(root, `${stagingName}.app`)]);
}

async function waitForExit(processId, executable, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const running = lsofRecords(["-a", "-d", "txt", "--", executable])
      .some((entry) => entry.processId === processId);
    if (!running) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return !lsofRecords(["-a", "-d", "txt", "--", executable])
    .some((entry) => entry.processId === processId);
}

export async function launchStaging(manifestPath) {
  const manifest = readManifest(manifestPath);
  verifyStagingApp(manifest, manifest.source);
  const existing = processesUnderRoot(manifest.root);
  if (existing.length) throw new Error("A process is already using the staging root");
  const logDescriptor = openSync(manifest.processLog, "a", 0o600);
  let child;
  try {
    child = spawn(manifest.executable, [
      `--user-data-dir=${manifest.userData}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${manifest.devToolsPort}`,
    ], {
      detached: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
      env: {
        ...process.env,
        CODEX_HOME: manifest.codexHome,
        CODEX_ELECTRON_USER_DATA_PATH: manifest.userData,
        CODEX_WORKFLOW_ROOT: manifest.workflowRoot,
        CODEX_SPARKLE_ENABLED: "false",
        CODEX_ELECTRON_PRIMARY_RUNTIME_UPDATE_MODE: "manual",
      },
    });
  } finally {
    closeSync(logDescriptor);
  }
  child.unref();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 750));
  const command = assertExactProcess(child.pid, manifest.executable);
  const next = {
    ...manifest,
    status: "running",
    processId: child.pid,
    launchedAt: new Date().toISOString(),
    processCommand: command,
  };
  writeJsonAtomic(manifest.manifest, next);
  return next;
}

export async function stopStaging(manifestPath) {
  const manifest = readManifest(manifestPath);
  if (!Number.isSafeInteger(manifest.processId) || manifest.processId <= 0) {
    throw new Error("Staging manifest has no running process");
  }
  if (!exactProcessIsRunning(manifest.processId, manifest.executable)) {
    if (processesUnderRoot(manifest.root).length) {
      throw new Error("Staging child processes remain after its main process exited");
    }
    const next = {
      ...manifest,
      status: "stopped",
      stoppedAt: new Date().toISOString(),
      processId: null,
    };
    writeJsonAtomic(manifest.manifest, next);
    return next;
  }
  assertExactProcess(manifest.processId, manifest.executable);
  process.kill(manifest.processId, "SIGTERM");
  if (!await waitForExit(manifest.processId, manifest.executable)) {
    assertExactProcess(manifest.processId, manifest.executable);
    process.kill(manifest.processId, "SIGKILL");
    if (!await waitForExit(manifest.processId, manifest.executable, 5000)) {
      throw new Error("Exact staging process did not stop");
    }
  }
  const deadline = Date.now() + 5000;
  let remaining = processesUnderRoot(manifest.root);
  while (remaining.length && Date.now() < deadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    remaining = processesUnderRoot(manifest.root);
  }
  if (remaining.length) throw new Error("Staging child processes are still running");
  const next = {
    ...manifest,
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    processId: null,
  };
  writeJsonAtomic(manifest.manifest, next);
  return next;
}

export function restoreStaging(manifestPath) {
  const manifest = readManifest(manifestPath);
  if (processesUnderRoot(manifest.root).length) {
    throw new Error("Stop the exact staging process before restore");
  }
  const backupAsar = assertManagedStagingPath(
    manifest.root,
    join(manifest.sourceBackup, "app.asar"),
    "source backup ASAR",
  );
  const backupPlist = assertManagedStagingPath(
    manifest.root,
    join(manifest.sourceBackup, "Info.plist"),
    "source backup plist",
  );
  const backupManifestPath = assertManagedStagingPath(
    manifest.root,
    join(manifest.sourceBackup, "manifest.json"),
    "source backup manifest",
  );
  const backupManifest = JSON.parse(readFileSync(backupManifestPath, "utf8"));
  if (
    backupManifest?.source?.asarSha256 !== manifest.source.asarSha256 ||
    fileHash(backupAsar) !== manifest.source.asarSha256 ||
    backupManifest?.plistSha256 !== fileHash(backupPlist)
  ) {
    throw new Error("Staging source backup does not match its manifest");
  }
  atomicReplace(backupAsar, manifest.asar);
  atomicReplace(backupPlist, manifest.plist);
  resignPatchedApp(manifest.app);
  const verification = verifyStagingApp(manifest, manifest.source, { restored: true });
  const next = {
    ...manifest,
    status: "restored",
    restoredAt: new Date().toISOString(),
    installed: null,
    verification: verification.checks,
  };
  writeJsonAtomic(manifest.manifest, next);
  return next;
}

export function cleanupStaging(manifestPath) {
  const manifest = readManifest(manifestPath);
  if (manifest.status !== "restored") {
    throw new Error("Restore and verify staging before cleanup");
  }
  if (processesUnderRoot(manifest.root).length) {
    throw new Error("A process is still using the staging root");
  }
  const root = assertStagingRoot(manifest.root);
  rmSync(root, { recursive: true, force: true });
  return { ok: true, status: "removed", root };
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const command = process.argv[2];
  let result;
  if (command === "prepare") {
    result = await prepareStaging(Number(optionValue("--port")));
  } else if (command === "launch") {
    result = await launchStaging(process.argv[3]);
  } else if (command === "stop") {
    result = await stopStaging(process.argv[3]);
  } else if (command === "restore") {
    result = restoreStaging(process.argv[3]);
  } else if (command === "cleanup") {
    result = cleanupStaging(process.argv[3]);
  } else {
    throw new Error("Usage: staging.mjs prepare --port <port> | launch|stop|restore|cleanup <manifest>");
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
