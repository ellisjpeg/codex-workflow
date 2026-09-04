"use strict";

const { app, ipcMain, session, webContents } = require("electron");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const runtimeRoot = process.env.CODEX_WORKFLOW_ROOT;
if (!runtimeRoot) throw new Error("CODEX_WORKFLOW_ROOT is not set");

const preloadPath = path.join(runtimeRoot, "runtime", "preload.cjs");
const settingsPath = path.join(runtimeRoot, "settings.json");
const disabledPath = path.join(runtimeRoot, "DISABLED");
const logDir = path.join(runtimeRoot, "logs");
const logPath = path.join(logDir, "runtime.log");
const updateConfigPath = path.join(runtimeRoot, "update-config.json");
const updateStatePath = path.join(runtimeRoot, "update-state.json");
const patchStatePath = path.join(runtimeRoot, "state.json");
const runtimeVersionPath = path.join(runtimeRoot, "runtime", "version.json");
const transactionPath = path.join(runtimeRoot, "transaction.json");
const updaterPath = path.join(runtimeRoot, "runtime", "updater.cjs");
const updateWatchers = [];
let updateLaunchInFlight = false;
let updateCheckInFlight = false;
const defaults = {
  schemaVersion: 2,
  focusedInterface: true,
  hidePullRequests: true,
  hidePetMenuItem: true,
  hideInviteFriendMenuItem: true,
  replaceHelpWithSettings: true,
  hideComposerMicrophone: false,
};

fs.mkdirSync(logDir, { recursive: true });

function appendLog(level, message) {
  try {
    const safeMessage = String(message).replaceAll("\0", "").slice(0, 4096);
    const line = `[${new Date().toISOString()}] [${level}] ${safeMessage}\n`;
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > 1024 * 1024) {
      const tail = fs.readFileSync(logPath).subarray(-512 * 1024);
      fs.writeFileSync(logPath, tail);
    }
    fs.appendFileSync(logPath, line);
  } catch {}
}

function normaliseSettings(value) {
  const legacyFocusedInterface = typeof value?.efficiencyMode === "boolean"
    ? value.efficiencyMode
    : defaults.focusedInterface;
  return {
    schemaVersion: 2,
    focusedInterface: typeof value?.focusedInterface === "boolean"
      ? value.focusedInterface
      : legacyFocusedInterface,
    hidePullRequests: typeof value?.hidePullRequests === "boolean"
      ? value.hidePullRequests
      : defaults.hidePullRequests,
    hidePetMenuItem: typeof value?.hidePetMenuItem === "boolean"
      ? value.hidePetMenuItem
      : defaults.hidePetMenuItem,
    hideInviteFriendMenuItem: typeof value?.hideInviteFriendMenuItem === "boolean"
      ? value.hideInviteFriendMenuItem
      : defaults.hideInviteFriendMenuItem,
    replaceHelpWithSettings: typeof value?.replaceHelpWithSettings === "boolean"
      ? value.replaceHelpWithSettings
      : defaults.replaceHelpWithSettings,
    hideComposerMicrophone: typeof value?.hideComposerMicrophone === "boolean"
      ? value.hideComposerMicrophone
      : defaults.hideComposerMicrophone,
  };
}

function readSettings() {
  try {
    return normaliseSettings(JSON.parse(fs.readFileSync(settingsPath, "utf8")));
  } catch {
    return { ...defaults };
  }
}

function writeSettings(patch) {
  const next = normaliseSettings({ ...readSettings(), ...patch });
  const tempPath = path.join(runtimeRoot, `.settings-${process.pid}-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(next, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(tempPath, settingsPath);
    const directory = fs.openSync(runtimeRoot, "r");
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
  return next;
}

function readJson(target) {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8"));
  } catch {
    return null;
  }
}

function versionParts(value) {
  const match = String(value || "").match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function readStagedUpdate(remote, installedVersion, updateConfig) {
  if (typeof remote?.stagedSourceRoot !== "string" || !remote.stagedSourceRoot) return null;
  const pkg = readJson(path.join(remote.stagedSourceRoot, "package.json"));
  const compatibility = readJson(path.join(remote.stagedSourceRoot, "workflow-compatibility.json"));
  const installPath = path.join(remote.stagedSourceRoot, "scripts", "install.mjs");
  const runtimeInstallPath = path.join(remote.stagedSourceRoot, "scripts", "install-runtime.mjs");
  if (
    pkg?.name !== "codex-workflow" ||
    !versionParts(pkg.version) ||
    remote.availableVersion !== pkg.version ||
    compatibility?.schemaVersion !== 1 ||
    compatibility.workflowVersion !== pkg.version ||
    compatibility.codexVersion !== updateConfig?.codexVersion ||
    compatibility.codexBuild !== updateConfig?.codexBuild ||
    compatibility.bundleIdentifier !== updateConfig?.bundleIdentifier ||
    compatibility.packageName !== updateConfig?.packageName ||
    compareVersions(pkg.version, installedVersion) <= 0 ||
    !fs.existsSync(installPath) ||
    !fs.existsSync(runtimeInstallPath)
  ) {
    return null;
  }
  return { version: pkg.version, root: remote.stagedSourceRoot };
}

function readUpdateStatus() {
  const installedVersion = readJson(runtimeVersionPath)?.version ||
    readJson(patchStatePath)?.runtimeVersion ||
    readJson(patchStatePath)?.patchVersion ||
    null;
  const updateConfig = readJson(updateConfigPath);
  const remote = readJson(updateStatePath);
  const staged = readStagedUpdate(remote, installedVersion, updateConfig);
  const blockedReason = updateConfig?.updatesDisabled === true
    ? "updates-disabled"
    : fs.existsSync(transactionPath) ? "recovery-required" : null;
  return {
    available: Boolean(staged) && !blockedReason,
    installedVersion,
    availableVersion: staged?.version || null,
    blockedReason,
    error: remote?.error || null,
  };
}

function updateCheckDue() {
  const remote = readJson(updateStatePath) || {};
  const nextCheckAt = Date.parse(remote.nextRemoteCheckAt || "");
  if (Number.isFinite(nextCheckAt)) return Date.now() >= nextCheckAt;
  const checkedAt = Date.parse(remote.remoteCheckedAt || "");
  return !Number.isFinite(checkedAt) || Date.now() - checkedAt >= 5 * 60 * 1000;
}

function triggerUpdateCheck() {
  if (updateCheckInFlight || !updateCheckDue()) return;
  const config = readJson(updateConfigPath);
  if (!config?.nodeExecutable || !fs.existsSync(config.nodeExecutable)) return;
  updateCheckInFlight = true;
  let finished = false;
  const finish = (error) => {
    if (finished) return;
    finished = true;
    updateCheckInFlight = false;
    if (error) appendLog("error", `Workflow update check failed: ${error}`);
    broadcastUpdateStatus();
  };
  try {
    const child = spawn(config.nodeExecutable, [updaterPath, "--check"], {
      stdio: "ignore",
      env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
    });
    child.once("error", (error) => finish(error?.message || error));
    child.once("close", (code, signal) => finish(
      code === 0 ? null : signal ? `signal ${signal}` : `exit ${code}`,
    ));
  } catch (error) {
    finish(error?.message || error);
  }
}

function broadcastUpdateStatus() {
  const status = readUpdateStatus();
  for (const contents of webContents?.getAllWebContents?.() || []) {
    if (!contents.isDestroyed?.()) contents.send("codex-workflow:update:status", status);
  }
}

function watchUpdateState() {
  try {
    const watcher = fs.watch(path.dirname(updateStatePath), { persistent: false }, (_event, filename) => {
      if (String(filename || "") === path.basename(updateStatePath)) broadcastUpdateStatus();
    });
    updateWatchers.push(watcher);
  } catch (error) {
    appendLog("error", `update state watch failed: ${error?.message || error}`);
  }
}

function isTrustedSender(event) {
  const url = event.senderFrame?.url || event.sender?.getURL?.() || "";
  return url.startsWith("app://");
}

function assertTrustedSender(event) {
  if (!isTrustedSender(event)) throw new Error("Codex Workflow rejected an untrusted renderer");
}

function registerPreload(targetSession, label) {
  if (fs.existsSync(disabledPath)) {
    appendLog("info", `patch disabled; skipped ${label}`);
    return;
  }
  try {
    if (typeof targetSession.registerPreloadScript === "function") {
      targetSession.registerPreloadScript({
        id: "codex-workflow",
        type: "frame",
        filePath: preloadPath,
      });
      appendLog("info", `registered preload on ${label}`);
      return;
    }
    appendLog("error", `registerPreloadScript unavailable on ${label}; sandbox fallback is unsupported`);
  } catch (error) {
    if (String(error?.message || error).includes("existing ID")) return;
    appendLog("error", `preload registration failed on ${label}: ${error?.stack || error}`);
  }
}

if (!globalThis.__codexWorkflowMainInstalled) {
  globalThis.__codexWorkflowMainInstalled = true;

  ipcMain.handle("codex-workflow:settings:get", (event) => {
    assertTrustedSender(event);
    return readSettings();
  });
  ipcMain.handle("codex-workflow:settings:set", (event, patch) => {
    assertTrustedSender(event);
    return writeSettings(patch);
  });
  ipcMain.handle("codex-workflow:settings:activate", (event, request) => {
    assertTrustedSender(event);
    const contents = event.sender;
    if (contents?.isDestroyed?.() || request?.target !== "keyboard-shortcut") {
      throw new Error("Codex Workflow rejected invalid Settings activation");
    }
    contents.sendInputEvent({ type: "keyDown", keyCode: ",", modifiers: ["meta"] });
    contents.sendInputEvent({ type: "keyUp", keyCode: ",", modifiers: ["meta"] });
    return true;
  });
  ipcMain.handle("codex-workflow:update:get", (event) => {
    assertTrustedSender(event);
    return readUpdateStatus();
  });
  ipcMain.handle("codex-workflow:update:install", async (event) => {
    assertTrustedSender(event);
    const status = readUpdateStatus();
    if (!status.available) return status;
    if (updateLaunchInFlight) return { ...status, applying: true };
    const config = readJson(updateConfigPath);
    if (!config?.nodeExecutable || !fs.existsSync(config.nodeExecutable)) {
      throw new Error("Workflow updater Node.js runtime is unavailable");
    }
    updateLaunchInFlight = true;
    appendLog("info", `Workflow update requested: ${status.installedVersion || "unknown"} -> ${status.availableVersion || "unknown"}`);
    try {
      const child = spawn(config.nodeExecutable, [updaterPath, "--apply"], {
        stdio: "ignore",
        env: { ...process.env, CODEX_WORKFLOW_ROOT: runtimeRoot },
      });
      await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => {
          if (code === 0) resolve();
          else reject(new Error(`Workflow updater exited ${signal ? `with ${signal}` : `with code ${code}`}`));
        });
      });
      appendLog("info", `Workflow update applied by process ${child.pid || "unknown"}`);
    } catch (error) {
      updateLaunchInFlight = false;
      appendLog("error", `Workflow updater failed: ${error?.stack || error}`);
      throw error;
    }
    const appliedStatus = readUpdateStatus();
    setImmediate(() => {
      app.relaunch();
      app.exit(0);
    });
    return { ...appliedStatus, applying: true };
  });
  ipcMain.on("codex-workflow:log", (event, level, message) => {
    if (!isTrustedSender(event)) return;
    appendLog(level === "error" ? "error" : "info", message);
  });

  app.whenReady().then(() => {
    registerPreload(session.defaultSession, "defaultSession");
    watchUpdateState();
    triggerUpdateCheck();
  });
  app.on("browser-window-focus", triggerUpdateCheck);
  app.on("session-created", (createdSession) => registerPreload(createdSession, "session-created"));
  app.on("web-contents-created", (_event, contents) => {
    appendLog("info", `web contents created: ${contents.id} ${contents.getType()}`);
    contents.on("preload-error", (_preloadEvent, preload, error) => {
      appendLog("error", `preload error for ${preload}: ${error?.stack || error}`);
    });
  });
  appendLog("info", `runtime loaded for app ${app.getVersion()}`);
}
