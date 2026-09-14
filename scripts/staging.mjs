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
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { userInfo } from "node:os";
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
  resolveSourceBackup,
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
export const stagingBundleIdentifier = "com.openai.codex.workflow-staging.v2690131953";
export const stagingName = "Codex Workflow Staging";
export const stagingExecutableName = "CodexWorkflowStaging-2690131953";
export const stagingLauncherName = "launch-workflow-staging";
export const stagingUnixSocketPathMaxBytes = 103;
export const stagingUpdaterPath = join(sourceRoot, "scripts", "staging-updater-disabled.cjs");

function lstatIfPresent(targetPath) {
  try {
    return lstatSync(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function assertStagingRoot(targetRoot) {
  const root = resolve(targetRoot);
  const temporaryRoot = resolve(stagingBaseRoot);
  if (dirname(root) !== temporaryRoot || !basename(root).startsWith(stagingPrefix)) {
    throw new Error("Staging root must be a generated direct child of the system temporary directory");
  }
  if (lstatIfPresent(root)?.isSymbolicLink()) {
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
    if (lstatIfPresent(current)?.isSymbolicLink()) {
      throw new Error(`Staging ${label} must not contain symbolic links`);
    }
  }
  return target;
}

export function assertStagingLayoutManaged(layout) {
  for (const key of [
    "app", "asar", "plist", "executable", "home", "temporary", "userData", "codexHome", "workflowRoot",
    "settings", "logs", "journal", "updates", "updateState", "backups", "sourceBackup",
    "processLog", "manifest",
  ]) {
    assertManagedStagingPath(layout.root, layout[key], key);
  }
  return layout;
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
    home: join(root, "state", "home"),
    temporary: join(root, "state", "tmp"),
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

export function assertMatchingSourceSnapshot(captured, cloned) {
  for (const field of ["version", "build", "asarSha256", "headerSha256"]) {
    if (captured?.fingerprint?.[field] !== cloned?.fingerprint?.[field]) {
      throw new Error(`Staging clone does not match captured source ${field}`);
    }
  }
  if (captured?.originalMain !== cloned?.originalMain) {
    throw new Error("Staging clone does not match captured source main entry");
  }
  return cloned;
}

export function assertInstalledFingerprint(manifest) {
  const current = fingerprint(manifest.asar);
  for (const field of ["version", "build", "asarSha256", "headerSha256"]) {
    if (manifest.installed?.[field] !== current[field]) {
      throw new Error(`Prepared staging ${field} fingerprint changed before launch`);
    }
  }
  return current;
}

export function stagingEnvironment(layout, hostEnvironment = process.env) {
  const environment = {
    // macOS Keychain and OAuth browser launches require the real account home.
    HOME: userInfo().homedir,
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    SHELL: "/bin/zsh",
    TMPDIR: layout.temporary,
    ZDOTDIR: layout.home,
    BASH_ENV: "/dev/null",
    ENV: "/dev/null",
    XDG_CACHE_HOME: join(layout.home, ".cache"),
    XDG_CONFIG_HOME: join(layout.home, ".config"),
    XDG_DATA_HOME: join(layout.home, ".local", "share"),
    CODEX_HOME: layout.codexHome,
    CODEX_ELECTRON_USER_DATA_PATH: layout.userData,
    CODEX_WORKFLOW_ROOT: layout.workflowRoot,
    CODEX_SPARKLE_ENABLED: "false",
    CODEX_ELECTRON_PRIMARY_RUNTIME_UPDATE_MODE: "manual",
  };
  for (const key of ["USER", "LOGNAME"]) {
    if (/^[a-z0-9._-]{1,64}$/iu.test(hostEnvironment[key] || "")) {
      environment[key] = hostEnvironment[key];
    }
  }
  for (const key of ["LANG", "LC_ALL", "LC_CTYPE"]) {
    if (/^[a-z0-9_.@-]{1,64}$/iu.test(hostEnvironment[key] || "")) {
      environment[key] = hostEnvironment[key];
    }
  }
  return environment;
}

function installStagingRuntime(layout, source) {
  assertStagingLayoutManaged(layout);
  for (const target of [
    layout.home,
    layout.temporary,
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
  for (const name of ["main.cjs", "preload.cjs"]) {
    cpSync(join(sourceRoot, "runtime", name), join(layout.workflowRoot, "runtime", name));
  }
  cpSync(stagingUpdaterPath, join(layout.workflowRoot, "runtime", "updater.cjs"));
  writeJsonAtomic(join(layout.workflowRoot, "runtime", "version.json"), {
    schemaVersion: 1,
    version: patchVersion,
  });
  writeJsonAtomic(layout.settings, {
    "schemaVersion": 3,
    "focusedInterface": true,
    "hidePullRequests": true,
    "hidePetMenuItem": true,
    "hideInviteFriendMenuItem": true,
    "replaceHelpWithSettings": true,
    "hideComposerMicrophone": false,
    "showUsageRemaining": true,
    "usageRemainingLocation": "toolbar",
    "hiddenSettingsPages": [],
    "sidebarNavigation": {
      "order": [
        "pull-requests",
        "scheduled",
        "plugins",
        "explore",
        "settings-shortcut"
      ],
      "hidden": [],
      "width": null,
      "showRecentChats": true,
      "settingsOrder": [],
      "settingsHidden": [],
      "accountOrder": [
        "usage",
        "pet",
        "invite",
        "settings",
        "logout"
      ],
      "accountHidden": []
    }
  });
  writeJsonAtomic(join(layout.workflowRoot, "update-config.json"), {
    schemaVersion: 1,
    sourceRoot: null,
    nodeExecutable: null,
    appRoot: layout.app,
    appExecutable: layout.executable,
    releaseApi: null,
    updatesDisabled: true,
    autoRepairCodexUpdates: false,
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

export function configureStagingLaunchEnvironment(layout) {
  assertStagingLayoutManaged(layout);
  const launcher = join(layout.app, 'Contents', 'MacOS', stagingLauncherName);
  assertManagedStagingPath(layout.root, launcher, 'staging launcher');
  const quote = value => `'${value.replaceAll("'", "'\"'\"'")}'`;
  const args = Object.entries(stagingEnvironment(layout, {})).map(([key,value]) => `${key}=${value}`);
  // Chromium's singleton check runs before Electron reads environment paths.
  args.push(layout.executable, `--user-data-dir=${layout.userData}`);
  writeFileSync(launcher, `#!/bin/sh\nexec /usr/bin/env -i ${args.map(quote).join(' ')} "$@"\n`, {mode:0o755});
  removePlistKey('LSEnvironment', layout.plist);
  setPlistString('CFBundleExecutable', stagingLauncherName, layout.plist);
}

function verifyStagingApp(layout, source, {
  restored = false,
  signatureCheck = signatureIsValid,
} = {}) {
  const pkg = readPackage(layout.asar);
  const integrity = headerHash(layout.asar);
  const runtimeFiles = ["main.cjs", "preload.cjs"].map((name) => ({
    name,
    matchesSource: fileHash(join(layout.workflowRoot, "runtime", name)) ===
      fileHash(join(sourceRoot, "runtime", name)),
  }));
  const updateConfig = JSON.parse(
    readFileSync(join(layout.workflowRoot, "update-config.json"), "utf8"),
  );
  const checks = {
    version: pkg.version === supportedVersion,
    build: String(pkg.codexBuildNumber || "unknown") === supportedBuild,
    packageBundleVersion: pkg.version ===
      plistValue("CFBundleShortVersionString", layout.plist),
    packageBundleBuild: String(pkg.codexBuildNumber || "unknown") ===
      plistValue("CFBundleVersion", layout.plist),
    packageName: pkg.name === expectedPackageName,
    bundleIdentifier: plistValue("CFBundleIdentifier", layout.plist) === stagingBundleIdentifier,
    bundleName: plistValue("CFBundleName", layout.plist) === stagingName,
    displayName: plistValue("CFBundleDisplayName", layout.plist) === stagingName,
    executableName: plistValue("CFBundleExecutable", layout.plist) === stagingLauncherName,
    executablePresent: existsSync(layout.executable),
    urlHandlersAbsent: !plistHasKey("CFBundleURLTypes", layout.plist),
    documentHandlersAbsent: !plistHasKey("CFBundleDocumentTypes", layout.plist),
    integrity: plistValue("ElectronAsarIntegrity:Resources/app.asar:hash", layout.plist) === integrity,
    signature: signatureCheck(layout.app),
    runtimeFiles: runtimeFiles.every((entry) => entry.matchesSource),
    updaterFailsClosed: fileHash(join(layout.workflowRoot, "runtime", "updater.cjs")) ===
      fileHash(stagingUpdaterPath),
    updateApplicationDisabled: updateConfig.updatesDisabled === true &&
      updateConfig.sourceRoot === null &&
      updateConfig.nodeExecutable === null &&
      updateConfig.releaseApi === null &&
      updateConfig.appRoot === layout.app &&
      updateConfig.appExecutable === layout.executable,
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

export async function prepareStaging(devToolsPort, hooks = {}) {
  if (process.platform !== "darwin") throw new Error("Staging is supported only on macOS");
  const checkPort = hooks.assertPortAvailable || assertPortAvailable;
  const sourcePreflight = hooks.sourcePreflight || (() => ({
    ...preflight(),
    sourceAsar: asarPath,
    sourcePlist: infoPlistPath,
  }));
  const clonePreflight = hooks.clonePreflight || ((targetAsar, targetPlist) =>
    preflight(targetAsar, targetPlist));
  const resolveBackup = hooks.resolveSourceBackup || resolveSourceBackup;
  const cloneApp = hooks.cloneApp || ((from, to) =>
    run("/bin/cp", ["-cR", from, to], "Could not create the APFS staging clone"));
  const createRoot = hooks.createRoot || (() => mkdtempSync(join(stagingBaseRoot, stagingPrefix)));
  const build = hooks.buildPatchedAsar || buildPatchedAsar;
  const resign = hooks.resignPatchedApp || resignPatchedApp;
  const signatureCheck = hooks.signatureIsValid || signatureIsValid;
  checkPort(devToolsPort);
  const current = sourcePreflight();
  const hasWorkflowMetadata = Object.hasOwn(current.pkg, "__codexWorkflow");
  const hasWorkflowLoader = current.pkg.main === "workflow-loader.cjs";
  if (hasWorkflowMetadata !== hasWorkflowLoader) {
    throw new Error("Staging source has ambiguous Workflow metadata");
  }
  let captured = current;
  let verifiedBackup = null;
  let evidencePaths = {
    kind: "live-stock-app",
    asar: current.sourceAsar || asarPath,
    plist: current.sourcePlist || infoPlistPath,
    manifest: null,
  };
  if (hasWorkflowMetadata) {
    const metadata = current.pkg.__codexWorkflow;
    if (!metadata || typeof metadata !== "object" || !metadata.source ||
      typeof metadata.originalMain !== "string") {
      throw new Error("Staging source has incomplete Workflow metadata");
    }
    verifiedBackup = resolveBackup(metadata.source);
    captured = assertMatchingSourceSnapshot(
      { fingerprint: metadata.source, originalMain: metadata.originalMain },
      preflight(verifiedBackup.backupAsar, verifiedBackup.backupPlist),
    );
    evidencePaths = {
      kind: "verified-workflow-backup",
      asar: verifiedBackup.backupAsar,
      plist: verifiedBackup.backupPlist,
      manifest: verifiedBackup.manifestPath,
    };
  }
  const source = { ...captured.fingerprint, originalMain: captured.originalMain };
  const sourceEvidence = { ...evidencePaths, fingerprint: source };
  const root = createRoot();
  const layout = stagingLayout(root, devToolsPort);
  try {
    assertStagingLayoutManaged(layout);
    cloneApp(appRoot, layout.app);
    assertStagingLayoutManaged(layout);
    if (verifiedBackup) {
      cpSync(verifiedBackup.backupAsar, layout.asar);
      cpSync(verifiedBackup.backupPlist, layout.plist);
      assertStagingLayoutManaged(layout);
    }
    const cloned = assertMatchingSourceSnapshot(
      captured,
      clonePreflight(layout.asar, layout.plist),
    );
    const originalExecutableName = plistValue("CFBundleExecutable", layout.plist);
    if (!originalExecutableName || originalExecutableName.includes("/")) {
      throw new Error("Stock Codex executable name is unsafe");
    }
    const originalExecutable = join(layout.app, "Contents", "MacOS", originalExecutableName);
    assertStagingLayoutManaged(layout);
    renameSync(originalExecutable, layout.executable);
    setPlistString("CFBundleIdentifier", stagingBundleIdentifier, layout.plist);
    setPlistString("CFBundleName", stagingName, layout.plist);
    setPlistString("CFBundleDisplayName", stagingName, layout.plist);
    setPlistString("CFBundleExecutable", stagingExecutableName, layout.plist);
    removePlistKey("CFBundleURLTypes", layout.plist);
    removePlistKey("CFBundleDocumentTypes", layout.plist);
    configureStagingLaunchEnvironment(layout);

    assertStagingLayoutManaged(layout);
    mkdirSync(layout.sourceBackup, { recursive: true, mode: 0o700 });
    cpSync(layout.asar, join(layout.sourceBackup, "app.asar"));
    cpSync(layout.plist, join(layout.sourceBackup, "Info.plist"));
    writeJsonAtomic(join(layout.sourceBackup, "manifest.json"), {
      schemaVersion: 1,
      source,
      plistSha256: fileHash(join(layout.sourceBackup, "Info.plist")),
      stagingBundleIdentifier,
    });
    installStagingRuntime(layout, source);

    assertStagingLayoutManaged(layout);
    const buildRoot = join(root, ".build");
    assertManagedStagingPath(root, buildRoot, "build workspace");
    mkdirSync(buildRoot, { mode: 0o700 });
    const patchedAsar = join(buildRoot, "app.asar");
    const immutableClone = { fingerprint: fingerprint(layout.asar), originalMain: source.originalMain };
    assertMatchingSourceSnapshot(cloned, immutableClone);
    await build(layout.asar, patchedAsar, cloned.fingerprint, layout.workflowRoot);
    assertStagingLayoutManaged(layout);
    assertMatchingSourceSnapshot(cloned, {
      fingerprint: fingerprint(layout.asar),
      originalMain: source.originalMain,
    });
    const patchedAsarSha256 = fileHash(patchedAsar);
    assertStagingLayoutManaged(layout);
    atomicReplace(patchedAsar, layout.asar);
    if (fileHash(layout.asar) !== patchedAsarSha256) {
      throw new Error("Staging ASAR replacement does not match the verified build output");
    }
    if (readPackage(layout.asar).main !== "workflow-loader.cjs") {
      throw new Error("Staging ASAR replacement does not contain the Workflow loader");
    }
    setPlistValue(
      "ElectronAsarIntegrity:Resources/app.asar:hash",
      headerHash(layout.asar),
      layout.plist,
    );
    assertStagingLayoutManaged(layout);
    resign(layout.app);
    assertManagedStagingPath(root, buildRoot, "build workspace");
    rmSync(buildRoot, { recursive: true, force: true });

    assertStagingLayoutManaged(layout);
    const verification = verifyStagingApp(layout, source, { signatureCheck });
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
      sourceEvidence,
      installed,
      patchVersion,
      processId: null,
      launchedAt: null,
      updaterIsolation: {
        sparkleEnabled: false,
        workflowReleaseApi: null,
        workflowUpdatesDisabled: true,
        updater: "fail-closed-stub",
        launchAgentInstalled: false,
      },
      verification: verification.checks,
    };
    assertStagingLayoutManaged(layout);
    writeJsonAtomic(layout.manifest, manifest);
    return manifest;
  } catch (error) {
    try {
      assertStagingRoot(root);
      rmSync(root, { recursive: true, force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Staging preparation failed and cleanup was unsafe");
    }
    throw error;
  }
}

function readManifest(manifestPath) {
  const resolvedManifest = resolve(manifestPath);
  const candidateRoot = assertStagingRoot(dirname(resolvedManifest));
  assertManagedStagingPath(candidateRoot, resolvedManifest, "manifest");
  const parsed = JSON.parse(readFileSync(resolvedManifest, "utf8"));
  if (parsed?.schemaVersion !== 1 || typeof parsed.root !== "string") {
    throw new Error("Staging manifest has an unsupported schema");
  }
  const layout = stagingLayout(parsed.root, parsed.devToolsPort);
  if (resolvedManifest !== layout.manifest) {
    throw new Error("Staging manifest is outside its validated root");
  }
  for (const key of [
    "app", "asar", "plist", "executable", "home", "temporary", "userData", "codexHome", "workflowRoot",
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
  const result = spawnSync("/usr/sbin/lsof", ["-nP", "-Fpcn", ...args], { encoding: "utf8" });
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error("Could not inspect staging processes");
  return parseLsofRecords(result.stdout);
}

export function parseLsofRecords(output) {
  const records = [];
  let record = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      record = { processId: Number(line.slice(1)), command: null, addresses: [] };
      records.push(record);
    } else if (record && line.startsWith("c")) {
      record.command = line.slice(1);
    } else if (record && line.startsWith("n")) {
      record.addresses.push(line.slice(1));
    }
  }
  return records.filter((entry) => Number.isSafeInteger(entry.processId));
}

function processesUnderRoot(root) {
  return lsofRecords(["+D", join(root, `${stagingName}.app`)]);
}

function processStartIdentity(processId) {
  const result = spawnSync(
    "/bin/ps",
    ["-p", String(processId), "-o", "pgid=", "-o", "lstart="],
    { encoding: "utf8", env: { LANG: "C", LC_ALL: "C" } },
  );
  if (result.status === 1 || !result.stdout.trim()) return null;
  if (result.status !== 0) throw new Error("Could not inspect staging process birth identity");
  const match = result.stdout.match(/^\s*(\d+)\s+(.+?)\s*$/u);
  if (!match) throw new Error("Could not parse staging process birth identity");
  const startedAt = processStartToken(match[2]);
  if (!startedAt) throw new Error("Could not canonicalize staging process birth identity");
  return {
    processId,
    processGroupId: Number(match[1]),
    startedAt,
  };
}

export function processStartToken(value) {
  const text = String(value || "").trim().replace(/\s+/gu, " ");
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/u.test(text)) return text;
  const months = new Map([
    ["Jan", "01"], ["Feb", "02"], ["Mar", "03"], ["Apr", "04"],
    ["May", "05"], ["Jun", "06"], ["Jul", "07"], ["Aug", "08"],
    ["Sep", "09"], ["Oct", "10"], ["Nov", "11"], ["Dec", "12"],
  ]);
  const match = text.match(
    /^(?:[A-Za-z]{3} )?(?:([A-Za-z]{3}) (\d{1,2})|(\d{1,2}) ([A-Za-z]{3})) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/u,
  );
  if (!match) return null;
  const month = months.get(match[1] || match[4]);
  const day = match[2] || match[3];
  if (!month || Number(day) < 1 || Number(day) > 31) return null;
  return `${match[8]}-${month}-${String(day).padStart(2, "0")}T${match[5]}:${match[6]}:${match[7]}`;
}

export function readProcessIdentity(processId, executable) {
  if (!Number.isSafeInteger(processId) || processId <= 0) return null;
  const usesExecutable = lsofRecords(["-a", "-d", "txt", "--", executable])
    .some((entry) => entry.processId === processId);
  if (!usesExecutable) return null;
  const start = processStartIdentity(processId);
  return start ? { ...start, executable } : null;
}

export function processIdentityMatches(expected, current) {
  return Boolean(expected && current) &&
    expected.processId === current.processId &&
    expected.processGroupId === current.processGroupId &&
    processStartToken(expected.startedAt) !== null &&
    processStartToken(expected.startedAt) === processStartToken(current.startedAt) &&
    expected.executable === current.executable;
}

function assertMatchingProcessIdentity(expected, current) {
  if (!processIdentityMatches(expected, current)) {
    throw new Error("Staging process birth or process-group identity does not match its manifest");
  }
  return current;
}

function persistedProcessIdentity(manifest) {
  const identity = manifest.processIdentity;
  if (
    !identity ||
    identity.processId !== manifest.processId ||
    identity.processGroupId !== identity.processId ||
    processStartToken(identity.startedAt) === null ||
    identity.executable !== manifest.executable
  ) {
    throw new Error("Staging manifest has no valid process birth or process-group identity");
  }
  return identity;
}

function portListenerRecords(port) {
  return lsofRecords(["-a", `-iTCP:${port}`, "-sTCP:LISTEN"]);
}

function isLoopbackListener(address, port) {
  const endpoint = String(address || "").replace(/\s+\(LISTEN\)$/u, "");
  if (endpoint === `[::1]:${port}`) return true;
  const ipv4 = endpoint.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+):(\d+)$/u);
  return Boolean(ipv4) &&
    Number(ipv4[1]) === 127 &&
    ipv4.slice(1, 5).every((part) => Number(part) <= 255) &&
    Number(ipv4[5]) === port;
}

export function listenerOwnershipForProcess(
  records,
  processIdentity,
  port,
  readIdentity = processStartIdentity,
) {
  const processIds = [...new Set(records.map((entry) => entry.processId))];
  if (!processIds.length) return null;
  const addresses = records.flatMap((entry) => entry.addresses || []);
  if (!addresses.length || addresses.some((address) => !isLoopbackListener(address, port))) {
    throw new Error("Staging DevTools listener is not bound exclusively to loopback");
  }
  const listeners = processIds.map((processId) => readIdentity(processId));
  if (
    listeners.some((identity) => !identity) ||
    listeners.some((identity) => identity.processGroupId !== processIdentity.processGroupId)
  ) {
    throw new Error("Staging DevTools listener is not owned by the launched process group");
  }
  return {
    processGroupId: processIdentity.processGroupId,
    addresses,
    listeners,
  };
}

const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

function lifecycleOperations(hooks = {}) {
  const operations = {
    assertPortAvailable: hooks.assertPortAvailable || assertPortAvailable,
    listAppProcesses: hooks.listAppProcesses || processesUnderRoot,
    readAnyProcessIdentity: hooks.readAnyProcessIdentity || processStartIdentity,
    readPortListeners: hooks.readPortListeners || portListenerRecords,
    readProcessIdentity: hooks.readProcessIdentity || readProcessIdentity,
    signalProcessGroup: hooks.signalProcessGroup || ((processGroupId, signal) =>
      process.kill(-processGroupId, signal)),
    signatureIsValid: hooks.signatureIsValid || signatureIsValid,
    signal: hooks.signal || null,
    sleep: hooks.sleep || delay,
    now: hooks.now || Date.now,
    spawnApp: hooks.spawnApp || ((executable, args, options) => spawn(executable, args, options)),
  };
  operations.waitForExit = hooks.waitForExit || ((identity, timeoutMs) =>
    waitForIdentityExit(identity, operations, timeoutMs));
  return operations;
}

function throwIfInterrupted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new Error("Staging launch interrupted");
}

async function waitForLaunchedIdentity(
  processId,
  executable,
  operations,
  launchError,
  timeoutMs = 5000,
) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (launchError()) throw launchError();
    const identity = operations.readProcessIdentity(processId, executable);
    if (identity) return identity;
    await operations.sleep(100);
  } while (Date.now() < deadline);
  if (launchError()) throw launchError();
  return null;
}

async function waitForIdentityExit(identity, operations, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const current = operations.readProcessIdentity(identity.processId, identity.executable);
    if (!current) return true;
    assertMatchingProcessIdentity(identity, current);
    await operations.sleep(250);
  } while (Date.now() < deadline);
  const current = operations.readProcessIdentity(identity.processId, identity.executable);
  if (!current) return true;
  assertMatchingProcessIdentity(identity, current);
  return false;
}

async function waitForOwnedListener(manifest, identity, operations, timeoutMs = 30000) {
  const deadline = operations.now() + timeoutMs;
  do {
    throwIfInterrupted(operations.signal);
    assertMatchingProcessIdentity(
      identity,
      operations.readProcessIdentity(identity.processId, identity.executable),
    );
    const ownership = listenerOwnershipForProcess(
      operations.readPortListeners(manifest.devToolsPort),
      identity,
      manifest.devToolsPort,
      operations.readAnyProcessIdentity,
    );
    if (ownership) return ownership;
    await operations.sleep(100);
  } while (operations.now() < deadline);
  throw new Error("Staging DevTools listener did not become ready");
}

function signalExactProcess(manifest, identity, signal, operations) {
  assertStagingLayoutManaged(manifest);
  assertMatchingProcessIdentity(
    identity,
    operations.readProcessIdentity(identity.processId, identity.executable),
  );
  operations.signalProcessGroup(identity.processGroupId, signal);
}

async function terminateExactProcess(manifest, identity, operations) {
  const current = operations.readProcessIdentity(identity.processId, identity.executable);
  if (!current) return;
  assertMatchingProcessIdentity(identity, current);
  signalExactProcess(manifest, identity, "SIGTERM", operations);
  if (!await operations.waitForExit(identity, 15000)) {
    signalExactProcess(manifest, identity, "SIGKILL", operations);
    if (!await operations.waitForExit(identity, 5000)) {
      throw new Error("Exact staging process group did not stop");
    }
  }
}

export async function launchStaging(manifestPath, hooks = {}) {
  const manifest = readManifest(manifestPath);
  assertInstalledFingerprint(manifest);
  const operations = lifecycleOperations(hooks);
  verifyStagingApp(manifest, manifest.source, { signatureCheck: operations.signatureIsValid });
  const existing = operations.listAppProcesses(manifest.root);
  if (existing.length) throw new Error("A process is already using the staging root");
  assertStagingLayoutManaged(manifest);
  const logDescriptor = openSync(manifest.processLog, "a", 0o600);
  let child;
  let childError = null;
  let identity;
  try {
    assertStagingLayoutManaged(manifest);
    operations.assertPortAvailable(manifest.devToolsPort);
    child = operations.spawnApp(manifest.executable, [
      `--user-data-dir=${manifest.userData}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${manifest.devToolsPort}`,
    ], {
      detached: true,
      stdio: ["ignore", logDescriptor, logDescriptor],
      env: stagingEnvironment(manifest, hooks.hostEnvironment ?? process.env),
    });
    closeSync(logDescriptor);
    child.once?.("error", (error) => {
      childError = error;
    });
    child.unref?.();
    identity = await waitForLaunchedIdentity(
      child.pid,
      manifest.executable,
      operations,
      () => childError,
    );
    if (!identity || identity.processGroupId !== child.pid) {
      throw new Error("Staging launch did not create the expected isolated process group");
    }
    writeJsonAtomic(manifest.manifest, {
      ...manifest,
      status: "launching",
      processId: child.pid,
      processIdentity: identity,
      launchedAt: new Date().toISOString(),
      listenerOwnership: null,
    });
    const listenerOwnership = await waitForOwnedListener(manifest, identity, operations);
    assertMatchingProcessIdentity(
      identity,
      operations.readProcessIdentity(identity.processId, identity.executable),
    );
    const next = {
      ...manifest,
      status: "running",
      processId: child.pid,
      processIdentity: identity,
      launchedAt: new Date().toISOString(),
      listenerOwnership: {
        port: manifest.devToolsPort,
        ...listenerOwnership,
      },
    };
    assertStagingLayoutManaged(manifest);
    writeJsonAtomic(manifest.manifest, next);
    return next;
  } catch (error) {
    try {
      if (child?.pid) {
        identity ||= operations.readProcessIdentity(child.pid, manifest.executable);
        if (identity) {
          await terminateExactProcess(manifest, identity, operations);
          stoppedManifest({
            ...manifest,
            processId: identity.processId,
            processIdentity: identity,
          });
        } else if (operations.listAppProcesses(manifest.root).length) {
          throw new Error("Launched staging process could not be identified safely for cleanup");
        }
      }
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Staging launch failed and safe cleanup was incomplete");
    }
    throw error;
  } finally {
    try {
      closeSync(logDescriptor);
    } catch {}
  }
}

function stoppedManifest(manifest) {
  const next = {
    ...manifest,
    status: "stopped",
    stoppedAt: new Date().toISOString(),
    processId: null,
    processIdentity: null,
    listenerOwnership: null,
  };
  assertStagingLayoutManaged(manifest);
  writeJsonAtomic(manifest.manifest, next);
  return next;
}

export async function stopStaging(manifestPath, hooks = {}) {
  const manifest = readManifest(manifestPath);
  const operations = lifecycleOperations(hooks);
  if (!Number.isSafeInteger(manifest.processId) || manifest.processId <= 0) {
    throw new Error("Staging manifest has no running process");
  }
  const identity = persistedProcessIdentity(manifest);
  const current = operations.readProcessIdentity(identity.processId, identity.executable);
  if (!current) {
    if (operations.listAppProcesses(manifest.root).length) {
      throw new Error("Staging child processes remain after its main process exited");
    }
    return stoppedManifest(manifest);
  }
  assertMatchingProcessIdentity(identity, current);
  await terminateExactProcess(manifest, identity, operations);
  const deadline = Date.now() + 5000;
  let remaining = operations.listAppProcesses(manifest.root);
  while (remaining.length && Date.now() < deadline) {
    await operations.sleep(250);
    remaining = operations.listAppProcesses(manifest.root);
  }
  if (remaining.length) throw new Error("Staging child processes are still running");
  return stoppedManifest(manifest);
}

// Refresh external runtime only; preserve this stage's settings and account state.
export function refreshStaging(manifestPath, hooks = {}) {
  const manifest = readManifest(manifestPath);
  if (manifest.status !== "stopped" || (hooks.listAppProcesses || processesUnderRoot)(manifest.root).length) {
    throw new Error("Stop the exact staging process before refreshing its runtime");
  }
  assertInstalledFingerprint(manifest);
  if (manifest.patchVersion !== patchVersion) throw new Error("A changed release version requires a new staging app");
  if (embeddedFileHash("workflow-loader.cjs", manifest.asar) !== fileHash(join(sourceRoot, "loader.cjs"))) {
    throw new Error("A changed loader requires a new staging app");
  }
  for (const name of ["main.cjs", "preload.cjs"]) {
    const target = join(manifest.workflowRoot, "runtime", name);
    assertManagedStagingPath(manifest.root, target, "runtime");
    atomicReplace(join(sourceRoot, "runtime", name), target);
  }
  const verification = verifyStagingApp(manifest, manifest.source, {
    signatureCheck: hooks.signatureIsValid || signatureIsValid,
  });
  const next = {...manifest, verification: verification.checks};
  writeJsonAtomic(manifest.manifest, next);
  return next;
}

export function restoreStaging(manifestPath, hooks = {}) {
  const manifest = readManifest(manifestPath);
  const listAppProcesses = hooks.listAppProcesses || processesUnderRoot;
  const resign = hooks.resignPatchedApp || resignPatchedApp;
  const signatureCheck = hooks.signatureIsValid || signatureIsValid;
  if (listAppProcesses(manifest.root).length) {
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
  assertStagingLayoutManaged(manifest);
  const restoreRoot = mkdtempSync(join(manifest.root, ".restore-"));
  try {
    const restoreAsar = assertManagedStagingPath(
      manifest.root,
      join(restoreRoot, "app.asar"),
      "restore ASAR",
    );
    const restorePlist = assertManagedStagingPath(
      manifest.root,
      join(restoreRoot, "Info.plist"),
      "restore plist",
    );
    cpSync(backupAsar, restoreAsar);
    cpSync(backupPlist, restorePlist);
    assertStagingLayoutManaged(manifest);
    assertManagedStagingPath(manifest.root, backupAsar, "source backup ASAR");
    assertManagedStagingPath(manifest.root, backupPlist, "source backup plist");
    atomicReplace(restoreAsar, manifest.asar);
    assertStagingLayoutManaged(manifest);
    assertManagedStagingPath(manifest.root, backupPlist, "source backup plist");
    atomicReplace(restorePlist, manifest.plist);
    assertStagingLayoutManaged(manifest);
    resign(manifest.app);
    assertStagingLayoutManaged(manifest);
    const verification = verifyStagingApp(manifest, manifest.source, {
      restored: true,
      signatureCheck,
    });
    const next = {
      ...manifest,
      status: "restored",
      restoredAt: new Date().toISOString(),
      installed: null,
      verification: verification.checks,
    };
    assertStagingLayoutManaged(manifest);
    writeJsonAtomic(manifest.manifest, next);
    return next;
  } finally {
    assertManagedStagingPath(manifest.root, restoreRoot, "restore workspace");
    rmSync(restoreRoot, { recursive: true, force: true });
  }
}

export function cleanupStaging(manifestPath, hooks = {}) {
  const manifest = readManifest(manifestPath);
  if (manifest.status !== "restored") {
    throw new Error("Restore and verify staging before cleanup");
  }
  const listAppProcesses = hooks.listAppProcesses || processesUnderRoot;
  if (listAppProcesses(manifest.root).length) {
    throw new Error("A process is still using the staging root");
  }
  const root = assertStagingRoot(manifest.root);
  assertStagingLayoutManaged(manifest);
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
  } else if (command === "refresh") {
    result = refreshStaging(process.argv[3]);
  } else if (command === "restore") {
    result = restoreStaging(process.argv[3]);
  } else if (command === "cleanup") {
    result = cleanupStaging(process.argv[3]);
  } else {
    throw new Error("Usage: staging.mjs prepare --port <port> | launch|stop|refresh|restore|cleanup <manifest>");
  }
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
